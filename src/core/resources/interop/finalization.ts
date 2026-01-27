// src/core/resources/interop/finalization.ts

import type { Address, Hex } from '../../types/primitives';
import type {
  InteropFinalizationInfo,
  InteropExpectedRoot,
  InteropMessageProof,
  InteropPhase,
  InteropStatus,
  InteropWaitable,
} from '../../types/flows/interop';
import type { ProofNormalized, ReceiptWithL2ToL1 } from '../../rpc/types';
import type { InteropTopics } from './events';
import {
  BUNDLE_IDENTIFIER,
  L1_MESSENGER_ADDRESS,
  L2_INTEROP_CENTER_ADDRESS,
  TOPIC_L1_MESSAGE_SENT_LEG,
  TOPIC_L1_MESSAGE_SENT_NEW,
} from '../../constants';
import { OP_INTEROP, isZKsyncError } from '../../types/errors';
import { createError } from '../../errors/factory';
import { messengerLogIndex } from '../withdrawals/logs';

type InteropLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  transactionHash?: Hex;
};

type InteropReceipt = { logs?: InteropLog[] };

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 300_000;

const ZERO_HASH = (`0x${'0'.repeat(64)}` as Hex);

export interface InteropFinalizationDeps {
  topics: InteropTopics;

  getInteropAddresses(): Promise<{ interopCenter: Address; interopHandler: Address }>;
  getSourceReceipt(txHash: Hex): Promise<InteropReceipt | null>;
  getReceiptWithL2ToL1(txHash: Hex): Promise<ReceiptWithL2ToL1 | null>;
  getL2ToL1LogProof(txHash: Hex, logIndex: number): Promise<ProofNormalized>;
  getDstLogs(args: { dstChainId: bigint; address: Address; topics: Hex[] }): Promise<InteropLog[]>;
  readInteropRoot(args: {
    dstChainId: bigint;
    rootChainId: bigint;
    batchNumber: bigint;
  }): Promise<Hex | null>;
  executeBundle(args: {
    dstChainId: bigint;
    encodedData: Hex;
    proof: InteropMessageProof;
  }): Promise<{ hash: Hex; wait: () => Promise<unknown> }>;
  decodeInteropBundleSent(log: { data: Hex; topics: Hex[] }): {
    bundleHash: Hex;
    sourceChainId?: bigint;
    destinationChainId: bigint;
  };
}

interface ResolvedInteropIds {
  l2SrcTxHash?: Hex;
  bundleHash?: Hex;
  dstChainId?: bigint;
  dstExecTxHash?: Hex;
}

export function resolveIdsFromWaitable(input: InteropWaitable): ResolvedInteropIds {
  if (typeof input === 'string') {
    return { l2SrcTxHash: input };
  }

  const asObj = input as ResolvedInteropIds;

  return {
    l2SrcTxHash: asObj.l2SrcTxHash,
    bundleHash: asObj.bundleHash,
    dstChainId: asObj.dstChainId,
    dstExecTxHash: asObj.dstExecTxHash,
  };
}

export function isFinalizationInfo(
  input: InteropWaitable | Hex | InteropFinalizationInfo,
): input is InteropFinalizationInfo {
  return (
    typeof input === 'object' &&
    input !== null &&
    'encodedData' in input &&
    'proof' in input &&
    'expectedRoot' in input
  );
}

function isL1MessageSentLog(log: InteropLog): boolean {
  const addr = log.address?.toLowerCase();
  const t0 = log.topics?.[0]?.toLowerCase();
  return (
    addr === L1_MESSENGER_ADDRESS.toLowerCase() &&
    (t0 === TOPIC_L1_MESSAGE_SENT_NEW.toLowerCase() ||
      t0 === TOPIC_L1_MESSAGE_SENT_LEG.toLowerCase())
  );
}

function decodeSingleBytes(data: Hex): Hex {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  if (hex.length < 64) {
    throw new Error('Encoded bytes is too short to decode.');
  }

  const offset = BigInt(`0x${hex.slice(0, 64)}`);
  if (offset > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Encoded bytes offset is too large.');
  }

  const lenPos = Number(offset) * 2;
  if (hex.length < lenPos + 64) {
    throw new Error('Encoded bytes length is out of bounds.');
  }

  const length = BigInt(`0x${hex.slice(lenPos, lenPos + 64)}`);
  if (length > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Encoded bytes length is too large.');
  }

  const dataStart = lenPos + 64;
  const dataEnd = dataStart + Number(length) * 2;
  if (hex.length < dataEnd) {
    throw new Error('Encoded bytes payload is out of bounds.');
  }

  return `0x${hex.slice(dataStart, dataEnd)}` as Hex;
}

function resolveTxIndex(raw: ReceiptWithL2ToL1): number {
  const record = raw as Record<string, unknown>;
  const idxRaw = record.transactionIndex ?? record.transaction_index ?? record.index;
  if (idxRaw == null) return 0;
  if (typeof idxRaw === 'number') return idxRaw;
  if (typeof idxRaw === 'bigint') return Number(idxRaw);
  if (typeof idxRaw === 'string') {
    try {
      return idxRaw.startsWith('0x') ? Number(BigInt(idxRaw)) : Number(idxRaw);
    } catch {
      return 0;
    }
  }
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseBundleSentFromSource(args: {
  deps: InteropFinalizationDeps;
  l2SrcTxHash: Hex;
}): Promise<{ bundleHash: Hex; dstChainId: bigint }> {
  const { deps, l2SrcTxHash } = args;
  const { interopCenter } = await deps.getInteropAddresses();
  const receipt = await deps.getSourceReceipt(l2SrcTxHash);

  if (!receipt) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.sourceReceipt,
      message: 'Source transaction receipt not found.',
      context: { l2SrcTxHash },
    });
  }

  const logs = receipt.logs ?? [];
  const wantAddr = interopCenter.toLowerCase();
  const wantTopic = deps.topics.interopBundleSent.toLowerCase();

  const found = logs.find(
    (log) =>
      (log.address ?? '').toLowerCase() === wantAddr &&
      (log.topics?.[0] ?? '').toLowerCase() === wantTopic,
  );

  if (!found) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.parseSentLog,
      message: 'Failed to locate InteropBundleSent event in source receipt.',
      context: { l2SrcTxHash, interopCenter },
    });
  }

  const decoded = deps.decodeInteropBundleSent({
    data: found.data,
    topics: found.topics,
  });

  return { bundleHash: decoded.bundleHash, dstChainId: decoded.destinationChainId };
}

interface BundleReceiptInfo {
  bundleHash: Hex;
  dstChainId: bigint;
  sourceChainId: bigint;
  l1MessageData: Hex;
  l1MessageIndex: number;
  l2ToL1LogIndex: number;
  txNumberInBatch: number;
  rawReceipt: ReceiptWithL2ToL1;
}

async function parseBundleReceiptInfo(args: {
  deps: InteropFinalizationDeps;
  l2SrcTxHash: Hex;
  bundleHash?: Hex;
}): Promise<BundleReceiptInfo> {
  const { deps, l2SrcTxHash, bundleHash: wantBundleHash } = args;
  const { interopCenter } = await deps.getInteropAddresses();

  const rawReceipt = await deps.getReceiptWithL2ToL1(l2SrcTxHash);

  if (!rawReceipt) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.sourceReceipt,
      message: 'Source transaction receipt not found.',
      context: { l2SrcTxHash },
    });
  }

  const logs = rawReceipt.logs ?? [];
  const wantAddr = interopCenter.toLowerCase();
  const wantTopic = deps.topics.interopBundleSent.toLowerCase();

  let l1MessageIndex = -1;
  let l1MessageData: Hex | null = null;
  let found:
    | { bundleHash: Hex; dstChainId: bigint; sourceChainId: bigint }
    | undefined;

  for (const log of logs) {
    if (isL1MessageSentLog(log)) {
      l1MessageIndex += 1;
      try {
        l1MessageData = decodeSingleBytes(log.data);
      } catch (e) {
        throw createError('STATE', {
          resource: 'interop',
          operation: OP_INTEROP.svc.status.parseSentLog,
          message: 'Failed to decode L1MessageSent log data for interop bundle.',
          context: { l2SrcTxHash, l1MessageIndex },
          cause: e as Error,
        });
      }
      continue;
    }

    const addr = (log.address ?? '').toLowerCase();
    const t0 = (log.topics?.[0] ?? '').toLowerCase();
    if (addr !== wantAddr || t0 !== wantTopic) continue;

    const decoded = deps.decodeInteropBundleSent({
      data: log.data,
      topics: log.topics,
    });

    if (
      wantBundleHash &&
      decoded.bundleHash.toLowerCase() !== wantBundleHash.toLowerCase()
    ) {
      continue;
    }

    if (decoded.sourceChainId == null) {
      throw createError('STATE', {
        resource: 'interop',
        operation: OP_INTEROP.svc.status.parseSentLog,
        message: 'InteropBundleSent log missing source chain id.',
        context: { l2SrcTxHash, interopCenter },
      });
    }

    found = {
      bundleHash: decoded.bundleHash,
      dstChainId: decoded.destinationChainId,
      sourceChainId: decoded.sourceChainId,
    };
    break;
  }

  if (!found) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.parseSentLog,
      message: 'Failed to locate InteropBundleSent event in source receipt.',
      context: { l2SrcTxHash, interopCenter, bundleHash: wantBundleHash },
    });
  }

  if (!l1MessageData) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.parseSentLog,
      message: 'Failed to locate L1MessageSent log data for interop bundle.',
      context: { l2SrcTxHash, interopCenter },
    });
  }

  if (l1MessageIndex < 0) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.parseSentLog,
      message: 'Failed to locate L1MessageSent log for interop bundle.',
      context: { l2SrcTxHash },
    });
  }

  let l2ToL1LogIndex: number;
  try {
    l2ToL1LogIndex = messengerLogIndex(rawReceipt, {
      index: l1MessageIndex,
      messenger: L1_MESSENGER_ADDRESS,
    });
  } catch (e) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.parseSentLog,
      message: 'Failed to derive L2->L1 messenger log index for interop bundle.',
      context: { l2SrcTxHash, l1MessageIndex },
      cause: e as Error,
    });
  }

  const txNumberInBatch = resolveTxIndex(rawReceipt);

  return {
    bundleHash: found.bundleHash,
    dstChainId: found.dstChainId,
    sourceChainId: found.sourceChainId,
    l1MessageData,
    l1MessageIndex,
    l2ToL1LogIndex,
    txNumberInBatch,
    rawReceipt,
  };
}

function isProofNotReadyError(err: unknown): boolean {
  if (!isZKsyncError(err)) return false;
  if (err.envelope.operation !== 'zksrpc.getL2ToL1LogProof') return false;

  if (
    err.envelope.type === 'STATE' &&
    err.envelope.message.toLowerCase().includes('proof not yet available')
  ) {
    return true;
  }

  const cause = err.envelope.cause as { message?: unknown; code?: unknown } | undefined;
  const causeMessage = typeof cause?.message === 'string' ? cause.message.toLowerCase() : '';

  return (
    causeMessage.includes('l1 batch') &&
    causeMessage.includes('not') &&
    causeMessage.includes('executed')
  );
}

function isReceiptNotFoundError(err: unknown): boolean {
  if (!isZKsyncError(err)) return false;
  return (
    err.envelope.operation === OP_INTEROP.svc.status.sourceReceipt &&
    err.envelope.type === 'STATE' &&
    err.envelope.message.toLowerCase().includes('receipt not found')
  );
}

async function waitForLogProof(args: {
  deps: InteropFinalizationDeps;
  l2SrcTxHash: Hex;
  logIndex: number;
  pollMs: number;
  deadlineMs: number;
}): Promise<ProofNormalized> {
  const { deps, l2SrcTxHash, logIndex, pollMs, deadlineMs } = args;

  while (true) {
    if (Date.now() > deadlineMs) {
      throw createError('TIMEOUT', {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.timeout,
        message: 'Timed out waiting for L2->L1 log proof to become available.',
        context: { l2SrcTxHash, logIndex },
      });
    }

    try {
      return await deps.getL2ToL1LogProof(l2SrcTxHash, logIndex);
    } catch (e) {
      if (isProofNotReadyError(e)) {
        await sleep(pollMs);
        continue;
      }
      throw e;
    }
  }
}

async function waitUntilRootAvailable(args: {
  deps: InteropFinalizationDeps;
  dstChainId: bigint;
  expectedRoot: InteropExpectedRoot;
  pollMs: number;
  deadlineMs: number;
}): Promise<void> {
  const { deps, dstChainId, expectedRoot, pollMs, deadlineMs } = args;

  while (true) {
    if (Date.now() > deadlineMs) {
      throw createError('TIMEOUT', {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.timeout,
        message: 'Timed out waiting for interop root to become available.',
        context: { dstChainId, expectedRoot },
      });
    }

    let root: Hex | null = null;
    try {
      const candidate = await deps.readInteropRoot({
        dstChainId,
        rootChainId: expectedRoot.rootChainId,
        batchNumber: expectedRoot.batchNumber,
      });
      if (candidate && candidate !== ZERO_HASH) {
        root = candidate;
      }
    } catch {
      root = null;
    }

    if (root) {
      if (root.toLowerCase() === expectedRoot.expectedRoot.toLowerCase()) {
        return;
      }
      throw createError('STATE', {
        resource: 'interop',
        operation: OP_INTEROP.wait,
        message: 'Interop root mismatch on destination chain.',
        context: { expected: expectedRoot.expectedRoot, got: root, dstChainId },
      });
    }

    await sleep(pollMs);
  }
}

async function queryDstBundleLifecycle(args: {
  deps: InteropFinalizationDeps;
  bundleHash: Hex;
  dstChainId: bigint;
}): Promise<{ phase: InteropPhase; dstExecTxHash?: Hex }> {
  const { deps, bundleHash, dstChainId } = args;
  const { interopHandler } = await deps.getInteropAddresses();

  const fetchLogsFor = async (eventTopic: Hex) => {
    return await deps.getDstLogs({
      dstChainId,
      address: interopHandler,
      topics: [eventTopic, bundleHash],
    });
  };

  const unbundledLogs = await fetchLogsFor(deps.topics.bundleUnbundled);
  if (unbundledLogs.length > 0) {
    const txHash = unbundledLogs.at(-1)?.transactionHash;
    return { phase: 'UNBUNDLED', dstExecTxHash: txHash };
  }

  const executedLogs = await fetchLogsFor(deps.topics.bundleExecuted);
  if (executedLogs.length > 0) {
    const txHash = executedLogs.at(-1)?.transactionHash;
    return { phase: 'EXECUTED', dstExecTxHash: txHash };
  }

  const verifiedLogs = await fetchLogsFor(deps.topics.bundleVerified);
  if (verifiedLogs.length > 0) {
    return { phase: 'VERIFIED' };
  }

  return { phase: 'SENT' };
}

export async function deriveInteropStatus(
  deps: InteropFinalizationDeps,
  input: InteropWaitable,
): Promise<InteropStatus> {
  const baseIds = resolveIdsFromWaitable(input);

  const enrichedIds = await (async () => {
    if (baseIds.bundleHash && baseIds.dstChainId) return baseIds;
    if (!baseIds.l2SrcTxHash) return baseIds;
    const { bundleHash, dstChainId } = await parseBundleSentFromSource({
      deps,
      l2SrcTxHash: baseIds.l2SrcTxHash,
    });
    return { ...baseIds, bundleHash, dstChainId };
  })();

  if (!enrichedIds.bundleHash || enrichedIds.dstChainId == null) {
    const phase: InteropPhase = enrichedIds.l2SrcTxHash ? 'SENT' : 'UNKNOWN';
    return {
      phase,
      l2SrcTxHash: enrichedIds.l2SrcTxHash,
      bundleHash: enrichedIds.bundleHash,
      dstExecTxHash: enrichedIds.dstExecTxHash,
      dstChainId: enrichedIds.dstChainId,
    };
  }

  const dstInfo = await queryDstBundleLifecycle({
    deps,
    bundleHash: enrichedIds.bundleHash,
    dstChainId: enrichedIds.dstChainId,
  });

  return {
    phase: dstInfo.phase,
    l2SrcTxHash: enrichedIds.l2SrcTxHash,
    bundleHash: enrichedIds.bundleHash,
    dstExecTxHash: dstInfo.dstExecTxHash ?? enrichedIds.dstExecTxHash,
    dstChainId: enrichedIds.dstChainId,
  };
}

export async function waitForInteropFinalization(
  deps: InteropFinalizationDeps,
  input: InteropWaitable | Hex | InteropFinalizationInfo,
  opts?: { pollMs?: number; timeoutMs?: number },
): Promise<InteropFinalizationInfo> {
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadlineMs = Date.now() + timeoutMs;

  if (isFinalizationInfo(input)) {
    await waitUntilRootAvailable({
      deps,
      dstChainId: input.dstChainId,
      expectedRoot: input.expectedRoot,
      pollMs,
      deadlineMs,
    });
    return input;
  }

  const ids = resolveIdsFromWaitable(input as InteropWaitable);
  if (!ids.l2SrcTxHash) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.wait,
      message: 'Cannot wait for interop finalization: missing l2SrcTxHash.',
      context: { input },
    });
  }

  let bundleInfo: BundleReceiptInfo | null = null;
  while (!bundleInfo) {
    if (Date.now() > deadlineMs) {
      throw createError('TIMEOUT', {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.timeout,
        message: 'Timed out waiting for source receipt to be available.',
        context: { l2SrcTxHash: ids.l2SrcTxHash },
      });
    }

    try {
      bundleInfo = await parseBundleReceiptInfo({
        deps,
        l2SrcTxHash: ids.l2SrcTxHash,
        bundleHash: ids.bundleHash,
      });
    } catch (e) {
      if (isReceiptNotFoundError(e)) {
        await sleep(pollMs);
        continue;
      }
      throw e;
    }
  }

  const messageData = bundleInfo.l1MessageData;
  if (messageData.length <= 4) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.wait,
      message: 'L1MessageSent data is too short to contain bundle payload.',
      context: { l2SrcTxHash: ids.l2SrcTxHash },
    });
  }

  const prefix = (`0x${messageData.slice(2, 4)}` as Hex).toLowerCase();
  if (prefix !== BUNDLE_IDENTIFIER.toLowerCase()) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.wait,
      message: 'Unexpected bundle prefix in L1MessageSent data.',
      context: { prefix, expected: BUNDLE_IDENTIFIER },
    });
  }

  const encodedData = `0x${messageData.slice(4)}` as Hex;
  const proof = await waitForLogProof({
    deps,
    l2SrcTxHash: ids.l2SrcTxHash,
    logIndex: bundleInfo.l2ToL1LogIndex,
    pollMs,
    deadlineMs,
  });

  if (!proof.root) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.wait,
      message: 'L2->L1 log proof missing expected root.',
      context: { l2SrcTxHash: ids.l2SrcTxHash },
    });
  }

  const expectedRoot: InteropExpectedRoot = {
    rootChainId: bundleInfo.sourceChainId,
    batchNumber: proof.batchNumber,
    expectedRoot: proof.root,
  };

  const messageProof: InteropMessageProof = {
    chainId: bundleInfo.sourceChainId,
    l1BatchNumber: proof.batchNumber,
    l2MessageIndex: proof.id,
    message: {
      txNumberInBatch: bundleInfo.txNumberInBatch,
      sender: L2_INTEROP_CENTER_ADDRESS,
      data: messageData,
    },
    proof: proof.proof,
  };

  await waitUntilRootAvailable({
    deps,
    dstChainId: bundleInfo.dstChainId,
    expectedRoot,
    pollMs,
    deadlineMs,
  });

  return {
    l2SrcTxHash: ids.l2SrcTxHash,
    bundleHash: bundleInfo.bundleHash,
    dstChainId: bundleInfo.dstChainId,
    expectedRoot,
    proof: messageProof,
    encodedData,
  };
}

export async function executeInteropBundle(
  deps: InteropFinalizationDeps,
  info: InteropFinalizationInfo,
): Promise<{ hash: Hex; wait: () => Promise<unknown> }> {
  const { bundleHash, dstChainId, encodedData, proof } = info;

  const dstStatus = await queryDstBundleLifecycle({
    deps,
    bundleHash,
    dstChainId,
  });

  if (dstStatus.phase === 'EXECUTED') {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.finalize,
      message: 'Interop bundle has already been executed.',
      context: { bundleHash, dstChainId },
    });
  }

  if (dstStatus.phase === 'UNBUNDLED') {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.finalize,
      message: 'Interop bundle has been unbundled and cannot be executed as a whole.',
      context: { bundleHash, dstChainId },
    });
  }

  return deps.executeBundle({ dstChainId, encodedData, proof });
}
