// src/core/resources/interop/finalization.ts
//
// Pure helper functions for interop finalization.
// Orchestration logic lives in adapters (viem/ethers finalization.ts).

import type { Address, Hex } from '../../types/primitives';
import type {
  InteropFinalizationInfo,
  InteropExpectedRoot,
  InteropMessageProof,
  InteropWaitable,
} from '../../types/flows/interop';
import type { ProofNormalized, ReceiptWithL2ToL1 } from '../../rpc/types';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InteropLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  transactionHash?: Hex;
};

export type InteropReceipt = { logs?: InteropLog[] };

export interface BundleReceiptInfo {
  bundleHash: Hex;
  dstChainId: bigint;
  sourceChainId: bigint;
  l1MessageData: Hex;
  l1MessageIndex: number;
  l2ToL1LogIndex: number;
  txNumberInBatch: number;
  rawReceipt: ReceiptWithL2ToL1;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_POLL_MS = 1_000;
export const DEFAULT_TIMEOUT_MS = 300_000;
export const ZERO_HASH: Hex = `0x${'0'.repeat(64)}`;

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

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

export function isL1MessageSentLog(log: InteropLog): boolean {
  const addr = log.address?.toLowerCase();
  const t0 = log.topics?.[0]?.toLowerCase();
  return (
    addr === L1_MESSENGER_ADDRESS.toLowerCase() &&
    (t0 === TOPIC_L1_MESSAGE_SENT_NEW.toLowerCase() ||
      t0 === TOPIC_L1_MESSAGE_SENT_LEG.toLowerCase())
  );
}

export function decodeSingleBytes(data: Hex): Hex {
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

  return `0x${hex.slice(dataStart, dataEnd)}`;
}

export function resolveTxIndex(raw: ReceiptWithL2ToL1): number {
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isProofNotReadyError(err: unknown): boolean {
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

export function isReceiptNotFoundError(err: unknown): boolean {
  if (!isZKsyncError(err)) return false;
  return (
    err.envelope.operation === OP_INTEROP.svc.status.sourceReceipt &&
    err.envelope.type === 'STATE' &&
    err.envelope.message.toLowerCase().includes('receipt not found')
  );
}

// ---------------------------------------------------------------------------
// Receipt parsing helpers (pure, take decoded data as input)
// ---------------------------------------------------------------------------

export interface ParseBundleSentInput {
  receipt: InteropReceipt;
  interopCenter: Address;
  interopBundleSentTopic: Hex;
  decodeInteropBundleSent: (log: { data: Hex; topics: Hex[] }) => {
    bundleHash: Hex;
    sourceChainId?: bigint;
    destinationChainId: bigint;
  };
}

export function parseBundleSentFromReceipt(
  input: ParseBundleSentInput,
  l2SrcTxHash: Hex,
): { bundleHash: Hex; dstChainId: bigint } {
  const { receipt, interopCenter, interopBundleSentTopic, decodeInteropBundleSent } = input;

  const logs = receipt.logs ?? [];
  const wantAddr = interopCenter.toLowerCase();
  const wantTopic = interopBundleSentTopic.toLowerCase();

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

  const decoded = decodeInteropBundleSent({
    data: found.data,
    topics: found.topics,
  });

  return { bundleHash: decoded.bundleHash, dstChainId: decoded.destinationChainId };
}

export interface ParseBundleReceiptInput {
  rawReceipt: ReceiptWithL2ToL1;
  interopCenter: Address;
  interopBundleSentTopic: Hex;
  decodeInteropBundleSent: (log: { data: Hex; topics: Hex[] }) => {
    bundleHash: Hex;
    sourceChainId?: bigint;
    destinationChainId: bigint;
  };
  wantBundleHash?: Hex;
}

export function parseBundleReceiptInfo(
  input: ParseBundleReceiptInput,
  l2SrcTxHash: Hex,
): BundleReceiptInfo {
  const {
    rawReceipt,
    interopCenter,
    interopBundleSentTopic,
    decodeInteropBundleSent,
    wantBundleHash,
  } = input;

  const logs = rawReceipt.logs ?? [];
  const wantAddr = interopCenter.toLowerCase();
  const wantTopic = interopBundleSentTopic.toLowerCase();

  let l1MessageIndex = -1;
  let l1MessageData: Hex | null = null;
  let found: { bundleHash: Hex; dstChainId: bigint; sourceChainId: bigint } | undefined;

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

    const decoded = decodeInteropBundleSent({
      data: log.data,
      topics: log.topics,
    });

    if (wantBundleHash && decoded.bundleHash.toLowerCase() !== wantBundleHash.toLowerCase()) {
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

// ---------------------------------------------------------------------------
// Finalization info building helpers
// ---------------------------------------------------------------------------

export function validateBundlePayload(messageData: Hex, l2SrcTxHash: Hex): Hex {
  if (messageData.length <= 4) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.wait,
      message: 'L1MessageSent data is too short to contain bundle payload.',
      context: { l2SrcTxHash },
    });
  }

  const prefix = `0x${messageData.slice(2, 4)}`.toLowerCase();
  if (prefix !== BUNDLE_IDENTIFIER.toLowerCase()) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.wait,
      message: 'Unexpected bundle prefix in L1MessageSent data.',
      context: { prefix, expected: BUNDLE_IDENTIFIER },
    });
  }

  return `0x${messageData.slice(4)}`;
}

export function buildFinalizationInfo(
  ids: { l2SrcTxHash: Hex; bundleHash?: Hex },
  bundleInfo: BundleReceiptInfo,
  proof: ProofNormalized,
  messageData: Hex,
): InteropFinalizationInfo {
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

  const encodedData = validateBundlePayload(messageData, ids.l2SrcTxHash);

  return {
    l2SrcTxHash: ids.l2SrcTxHash,
    bundleHash: bundleInfo.bundleHash,
    dstChainId: bundleInfo.dstChainId,
    expectedRoot,
    proof: messageProof,
    encodedData,
  };
}

// ---------------------------------------------------------------------------
// Error creation helpers
// ---------------------------------------------------------------------------

export function createTimeoutError(
  operation: string,
  message: string,
  context: Record<string, unknown>,
): Error {
  return createError('TIMEOUT', {
    resource: 'interop',
    operation,
    message,
    context,
  });
}

export function createStateError(
  operation: string,
  message: string,
  context: Record<string, unknown>,
): Error {
  return createError('STATE', {
    resource: 'interop',
    operation,
    message,
    context,
  });
}
