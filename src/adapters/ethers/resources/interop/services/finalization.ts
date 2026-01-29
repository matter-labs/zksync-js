import { Contract, Interface, type TransactionReceipt } from 'ethers';

import type { Address, Hex } from '../../../../../core/types/primitives';
import type { EthersClient } from '../../../client';
import type {
  InteropStatus,
  InteropWaitable,
  InteropFinalizationInfo,
  InteropPhase,
} from '../../../../../core/types/flows/interop';

import { createErrorHandlers, toZKsyncError } from '../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../core/types';
import { InteropRootStorageABI } from '../../../../../core/abi';
import { L2_INTEROP_ROOT_STORAGE_ADDRESS } from '../../../../../core/constants';
import { createError } from '../../../../../core/errors/factory';
import { isZKsyncError } from '../../../../../core/types/errors';
import {
  resolveIdsFromWaitable,
  parseBundleSentFromReceipt,
  parseBundleReceiptInfo,
  buildFinalizationInfo,
  isProofNotReadyError,
  isReceiptNotFoundError,
  sleep,
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  ZERO_HASH,
  createTimeoutError,
  createStateError,
  type InteropLog,
  type BundleReceiptInfo,
} from '../../../../../core/resources/interop/finalization';

// ABIs we need to decode events / send executeBundle()
import InteropCenterAbi from '../../../../../core/internal/abis/InteropCenter';
import IInteropHandlerAbi from '../../../../../core/internal/abis/IInteropHandler';

// error handling
const { wrap } = createErrorHandlers('interop');

// ---------------------------------------------------------------------------
// Event topics and decoding
// ---------------------------------------------------------------------------

interface InteropTopics {
  interopBundleSent: Hex;
  bundleVerified: Hex;
  bundleExecuted: Hex;
  bundleUnbundled: Hex;
}

function getTopics(): { topics: InteropTopics; centerIface: Interface } {
  const centerIface = new Interface(InteropCenterAbi);
  const handlerIface = new Interface(IInteropHandlerAbi);

  const topics = {
    interopBundleSent: centerIface.getEvent('InteropBundleSent')!.topicHash as Hex,
    bundleVerified: handlerIface.getEvent('BundleVerified')!.topicHash as Hex,
    bundleExecuted: handlerIface.getEvent('BundleExecuted')!.topicHash as Hex,
    bundleUnbundled: handlerIface.getEvent('BundleUnbundled')!.topicHash as Hex,
  };

  return { topics, centerIface };
}

function decodeInteropBundleSent(
  centerIface: Interface,
  log: { data: Hex; topics: Hex[] },
): {
  bundleHash: Hex;
  sourceChainId?: bigint;
  destinationChainId: bigint;
} {
  const decoded = centerIface.decodeEventLog(
    'InteropBundleSent',
    log.data,
    log.topics,
  ) as unknown as {
    interopBundleHash: Hex;
    interopBundle: {
      sourceChainId: bigint;
      destinationChainId: bigint;
    };
  };

  return {
    bundleHash: decoded.interopBundleHash,
    sourceChainId: decoded.interopBundle.sourceChainId,
    destinationChainId: decoded.interopBundle.destinationChainId,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers using client directly
// ---------------------------------------------------------------------------

async function getSourceReceipt(client: EthersClient, txHash: Hex) {
  const receipt = await wrap(
    OP_INTEROP.svc.status.sourceReceipt,
    () => client.l2.getTransactionReceipt(txHash),
    {
      ctx: { where: 'l2.getTransactionReceipt', l2SrcTxHash: txHash },
      message: 'Failed to fetch source L2 receipt for interop tx.',
    },
  );
  if (!receipt) return null;
  return {
    logs: receipt.logs?.map((log) => ({
      address: log.address as Address,
      topics: [...log.topics] as Hex[],
      data: log.data as Hex,
      transactionHash: log.transactionHash as Hex,
    })),
  };
}

async function getDstLogs(
  client: EthersClient,
  args: { dstChainId: bigint; address: Address; topics: Hex[] },
): Promise<InteropLog[]> {
  return await wrap(
    OP_INTEROP.svc.status.dstLogs,
    async () => {
      const dstProvider = client.requireProvider(args.dstChainId);
      const rawLogs = await dstProvider.getLogs({
        address: args.address,
        fromBlock: 0n,
        toBlock: 'latest',
        topics: args.topics,
      });

      return rawLogs.map((log) => ({
        address: log.address as Address,
        topics: log.topics as Hex[],
        data: log.data as Hex,
        transactionHash: log.transactionHash as Hex,
      }));
    },
    {
      ctx: { dstChainId: args.dstChainId, address: args.address },
      message: 'Failed to query destination bundle lifecycle logs.',
    },
  );
}

async function readInteropRoot(
  client: EthersClient,
  args: { dstChainId: bigint; rootChainId: bigint; batchNumber: bigint },
): Promise<Hex | null> {
  const dstProvider = await wrap(
    OP_INTEROP.svc.status.requireDstProvider,
    () => client.requireProvider(args.dstChainId),
    {
      ctx: { where: 'requireProvider', dstChainId: args.dstChainId },
      message: 'Failed to acquire destination provider.',
    },
  );

  const rootStorage = new Contract(
    L2_INTEROP_ROOT_STORAGE_ADDRESS,
    InteropRootStorageABI,
    dstProvider,
  ) as Contract & {
    interopRoots: (chainId: bigint, batchNumber: bigint) => Promise<Hex>;
  };

  return await rootStorage.interopRoots(args.rootChainId, args.batchNumber);
}

async function queryDstBundleLifecycle(
  client: EthersClient,
  topics: InteropTopics,
  bundleHash: Hex,
  dstChainId: bigint,
): Promise<{ phase: InteropPhase; dstExecTxHash?: Hex }> {
  const { interopHandler } = await wrap(
    OP_INTEROP.svc.status.ensureAddresses,
    () => client.ensureAddresses(),
    {
      ctx: { where: 'ensureAddresses' },
      message: 'Failed to ensure interop addresses.',
    },
  );

  const fetchLogsFor = async (eventTopic: Hex) => {
    return await getDstLogs(client, {
      dstChainId,
      address: interopHandler,
      topics: [eventTopic, bundleHash],
    });
  };

  const unbundledLogs = await fetchLogsFor(topics.bundleUnbundled);
  if (unbundledLogs.length > 0) {
    const txHash = unbundledLogs.at(-1)?.transactionHash;
    return { phase: 'UNBUNDLED', dstExecTxHash: txHash };
  }

  const executedLogs = await fetchLogsFor(topics.bundleExecuted);
  if (executedLogs.length > 0) {
    const txHash = executedLogs.at(-1)?.transactionHash;
    return { phase: 'EXECUTED', dstExecTxHash: txHash };
  }

  const verifiedLogs = await fetchLogsFor(topics.bundleVerified);
  if (verifiedLogs.length > 0) {
    return { phase: 'VERIFIED' };
  }

  return { phase: 'SENT' };
}

async function waitForLogProof(
  client: EthersClient,
  l2SrcTxHash: Hex,
  logIndex: number,
  pollMs: number,
  deadlineMs: number,
) {
  while (true) {
    if (Date.now() > deadlineMs) {
      throw createTimeoutError(
        OP_INTEROP.svc.wait.timeout,
        'Timed out waiting for L2->L1 log proof to become available.',
        { l2SrcTxHash, logIndex },
      );
    }

    try {
      return await client.zks.getL2ToL1LogProof(l2SrcTxHash, logIndex);
    } catch (e) {
      if (isProofNotReadyError(e)) {
        await sleep(pollMs);
        continue;
      }
      throw e;
    }
  }
}

async function waitUntilRootAvailable(
  client: EthersClient,
  dstChainId: bigint,
  expectedRoot: { rootChainId: bigint; batchNumber: bigint; expectedRoot: Hex },
  pollMs: number,
  deadlineMs: number,
): Promise<void> {
  while (true) {
    if (Date.now() > deadlineMs) {
      throw createTimeoutError(
        OP_INTEROP.svc.wait.timeout,
        'Timed out waiting for interop root to become available.',
        { dstChainId, expectedRoot },
      );
    }

    let root: Hex | null = null;
    try {
      const candidate = await readInteropRoot(client, {
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
      throw createStateError(OP_INTEROP.wait, 'Interop root mismatch on destination chain.', {
        expected: expectedRoot.expectedRoot,
        got: root,
        dstChainId,
      });
    }

    await sleep(pollMs);
  }
}

// ---------------------------------------------------------------------------
// Public API: deriveStatus, waitForFinalization, executeBundle
// ---------------------------------------------------------------------------

async function deriveInteropStatus(
  client: EthersClient,
  input: InteropWaitable,
): Promise<InteropStatus> {
  const { topics, centerIface } = getTopics();
  const baseIds = resolveIdsFromWaitable(input);

  const enrichedIds = await (async () => {
    if (baseIds.bundleHash && baseIds.dstChainId) return baseIds;
    if (!baseIds.l2SrcTxHash) return baseIds;

    const { interopCenter } = await wrap(
      OP_INTEROP.svc.status.ensureAddresses,
      () => client.ensureAddresses(),
      {
        ctx: { where: 'ensureAddresses' },
        message: 'Failed to ensure interop addresses.',
      },
    );

    const receipt = await getSourceReceipt(client, baseIds.l2SrcTxHash);
    if (!receipt) {
      throw createStateError(
        OP_INTEROP.svc.status.sourceReceipt,
        'Source transaction receipt not found.',
        { l2SrcTxHash: baseIds.l2SrcTxHash },
      );
    }

    const { bundleHash, dstChainId } = parseBundleSentFromReceipt(
      {
        receipt: { logs: receipt.logs as InteropLog[] },
        interopCenter,
        interopBundleSentTopic: topics.interopBundleSent,
        decodeInteropBundleSent: (log) => decodeInteropBundleSent(centerIface, log),
      },
      baseIds.l2SrcTxHash,
    );

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

  const dstInfo = await queryDstBundleLifecycle(
    client,
    topics,
    enrichedIds.bundleHash,
    enrichedIds.dstChainId,
  );

  return {
    phase: dstInfo.phase,
    l2SrcTxHash: enrichedIds.l2SrcTxHash,
    bundleHash: enrichedIds.bundleHash,
    dstExecTxHash: dstInfo.dstExecTxHash ?? enrichedIds.dstExecTxHash,
    dstChainId: enrichedIds.dstChainId,
  };
}

async function waitForInteropFinalization(
  client: EthersClient,
  input: InteropWaitable | Hex,
  opts?: { pollMs?: number; timeoutMs?: number },
): Promise<InteropFinalizationInfo> {
  const { topics, centerIface } = getTopics();
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadlineMs = Date.now() + timeoutMs;

  const ids = resolveIdsFromWaitable(input);
  if (!ids.l2SrcTxHash) {
    throw createStateError(
      OP_INTEROP.wait,
      'Cannot wait for interop finalization: missing l2SrcTxHash.',
      { input },
    );
  }

  const { interopCenter } = await wrap(
    OP_INTEROP.svc.status.ensureAddresses,
    () => client.ensureAddresses(),
    {
      ctx: { where: 'ensureAddresses' },
      message: 'Failed to ensure interop addresses.',
    },
  );

  let bundleInfo: BundleReceiptInfo | null = null;
  while (!bundleInfo) {
    if (Date.now() > deadlineMs) {
      throw createTimeoutError(
        OP_INTEROP.svc.wait.timeout,
        'Timed out waiting for source receipt to be available.',
        { l2SrcTxHash: ids.l2SrcTxHash },
      );
    }

    try {
      const rawReceipt = await wrap(
        OP_INTEROP.svc.status.sourceReceipt,
        () => client.zks.getReceiptWithL2ToL1(ids.l2SrcTxHash!),
        {
          ctx: { where: 'zks.getReceiptWithL2ToL1', l2SrcTxHash: ids.l2SrcTxHash },
          message: 'Failed to fetch source L2 receipt (with L2->L1 logs) for interop tx.',
        },
      );

      if (!rawReceipt) {
        await sleep(pollMs);
        continue;
      }

      bundleInfo = parseBundleReceiptInfo(
        {
          rawReceipt,
          interopCenter,
          interopBundleSentTopic: topics.interopBundleSent,
          decodeInteropBundleSent: (log) => decodeInteropBundleSent(centerIface, log),
          wantBundleHash: ids.bundleHash,
        },
        ids.l2SrcTxHash,
      );
    } catch (e) {
      if (isReceiptNotFoundError(e)) {
        await sleep(pollMs);
        continue;
      }
      throw e;
    }
  }

  const proof = await waitForLogProof(
    client,
    ids.l2SrcTxHash,
    bundleInfo.l2ToL1LogIndex,
    pollMs,
    deadlineMs,
  );

  const info = buildFinalizationInfo(
    { l2SrcTxHash: ids.l2SrcTxHash, bundleHash: ids.bundleHash },
    bundleInfo,
    proof,
    bundleInfo.l1MessageData,
  );

  await waitUntilRootAvailable(client, bundleInfo.dstChainId, info.expectedRoot, pollMs, deadlineMs);

  return info;
}

async function executeInteropBundle(
  client: EthersClient,
  info: InteropFinalizationInfo,
): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }> {
  const { topics } = getTopics();
  const { bundleHash, dstChainId, encodedData, proof } = info;

  const dstStatus = await queryDstBundleLifecycle(client, topics, bundleHash, dstChainId);

  if (dstStatus.phase === 'EXECUTED') {
    throw createStateError(OP_INTEROP.finalize, 'Interop bundle has already been executed.', {
      bundleHash,
      dstChainId,
    });
  }

  if (dstStatus.phase === 'UNBUNDLED') {
    throw createStateError(
      OP_INTEROP.finalize,
      'Interop bundle has been unbundled and cannot be executed as a whole.',
      { bundleHash, dstChainId },
    );
  }

  const signer = await wrap(
    OP_INTEROP.exec.sendStep,
    () => client.signerFor(dstChainId),
    {
      ctx: { dstChainId },
      message: 'Failed to resolve destination signer.',
    },
  );

  const { interopHandler } = await wrap(
    OP_INTEROP.svc.status.ensureAddresses,
    () => client.ensureAddresses(),
    {
      ctx: { where: 'ensureAddresses' },
      message: 'Failed to ensure interop handler address.',
    },
  );

  const handler = new Contract(interopHandler, IInteropHandlerAbi, signer) as Contract & {
    executeBundle: (
      bundle: Hex,
      proof: InteropFinalizationInfo['proof'],
    ) => Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }>;
  };

  try {
    const txResp = await handler.executeBundle(encodedData, proof);
    const hash = txResp.hash;

    return {
      hash,
      wait: async () => {
        try {
          const receipt = (await txResp.wait()) as TransactionReceipt | null;
          if (!receipt || receipt.status !== 1) {
            throw createError('EXECUTION', {
              resource: 'interop',
              operation: OP_INTEROP.exec.waitStep,
              message: 'Interop bundle execution reverted on destination.',
              context: { dstChainId, txHash: hash },
            });
          }
          return receipt;
        } catch (e) {
          if (isZKsyncError(e)) throw e;
          throw toZKsyncError(
            'EXECUTION',
            {
              resource: 'interop',
              operation: OP_INTEROP.exec.waitStep,
              message: 'Failed while waiting for executeBundle transaction on destination.',
              context: { dstChainId, txHash: hash },
            },
            e,
          );
        }
      },
    };
  } catch (e) {
    throw toZKsyncError(
      'EXECUTION',
      {
        resource: 'interop',
        operation: OP_INTEROP.exec.sendStep,
        message: 'Failed to send executeBundle transaction on destination chain.',
        context: { dstChainId },
      },
      e,
    );
  }
}

// ---------------------------------------------------------------------------
// Exported service interface
// ---------------------------------------------------------------------------

export interface InteropFinalizationServices {
  deriveStatus(input: InteropWaitable): Promise<InteropStatus>;

  waitForFinalization(
    input: InteropWaitable | Hex,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;

  executeBundle(
    info: InteropFinalizationInfo,
  ): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }>;
}

export function createInteropFinalizationServices(
  client: EthersClient,
): InteropFinalizationServices {
  return {
    async deriveStatus(input) {
      return await deriveInteropStatus(client, input);
    },

    async waitForFinalization(input, opts) {
      return await waitForInteropFinalization(client, input, opts);
    },

    async executeBundle(info) {
      return await executeInteropBundle(client, info);
    },
  };
}

// -----------------------------
// Thin wrappers that the resource factory calls
// -----------------------------
export async function status(client: EthersClient, h: InteropWaitable): Promise<InteropStatus> {
  return wrap(OP_INTEROP.status, () => deriveInteropStatus(client, h), {
    message: 'Internal error while checking interop status.',
    ctx: { where: 'interop.status' },
  });
}

export async function wait(
  client: EthersClient,
  h: InteropWaitable,
  opts?: { for?: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
): Promise<InteropFinalizationInfo> {
  return wrap(
    OP_INTEROP.wait,
    () =>
      waitForInteropFinalization(client, h, {
        pollMs: opts?.pollMs,
        timeoutMs: opts?.timeoutMs,
      }),
    {
      message: 'Internal error while waiting for interop finalization.',
      ctx: { where: 'interop.wait', for: opts?.for },
    },
  );
}
