import type { TransactionReceipt, Abi, AbiEvent } from 'viem';
import { decodeAbiParameters, decodeEventLog, getAbiItem, getEventSelector } from 'viem';

import type { Address, Hex } from '../../../../../core/types/primitives';
import type { ViemClient } from '../../../client';
import type {
  InteropStatus,
  InteropWaitable,
  InteropFinalizationInfo,
  InteropPhase,
} from '../../../../../core/types/flows/interop';

import { createErrorHandlers, toZKsyncError } from '../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../core/types';
import { isZKsyncError, isReceiptNotFound } from '../../../../../core/types/errors';
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
import { InteropRootStorageABI } from '../../../../../core/abi';
import { L2_INTEROP_ROOT_STORAGE_ADDRESS } from '../../../../../core/constants';

// ABIs we need to decode events / send executeBundle()
import InteropCenterAbi from '../../../../../core/internal/abis/InteropCenter';
import IInteropHandlerAbi from '../../../../../core/internal/abis/IInteropHandler';

// error handling
const { wrap } = createErrorHandlers('interop');

// ---------------------------------------------------------------------------
// Event topics
// ---------------------------------------------------------------------------

interface InteropTopics {
  interopBundleSent: Hex;
  bundleVerified: Hex;
  bundleExecuted: Hex;
  bundleUnbundled: Hex;
}

function eventTopic(abi: unknown, name: string): Hex {
  const item = getAbiItem({ abi: abi as Abi, name });
  return getEventSelector(item as AbiEvent);
}

function getTopics(): InteropTopics {
  return {
    interopBundleSent: eventTopic(InteropCenterAbi, 'InteropBundleSent'),
    bundleVerified: eventTopic(IInteropHandlerAbi, 'BundleVerified'),
    bundleExecuted: eventTopic(IInteropHandlerAbi, 'BundleExecuted'),
    bundleUnbundled: eventTopic(IInteropHandlerAbi, 'BundleUnbundled'),
  };
}

function decodeInteropBundleSent(log: { data: Hex; topics: Hex[] }): {
  bundleHash: Hex;
  sourceChainId: bigint;
  destinationChainId: bigint;
} {
  const decoded = decodeEventLog({
    abi: InteropCenterAbi,
    data: log.data,
    topics: log.topics as [Hex, ...Hex[]],
  }) as {
    eventName: 'InteropBundleSent';
    args: {
      interopBundleHash: Hex;
      interopBundle: {
        sourceChainId: bigint;
        destinationChainId: bigint;
      };
    };
  };

  return {
    bundleHash: decoded.args.interopBundleHash,
    sourceChainId: decoded.args.interopBundle.sourceChainId,
    destinationChainId: decoded.args.interopBundle.destinationChainId,
  };
}

function decodeL1MessageData(log: InteropLog): Hex {
  const [message] = decodeAbiParameters([{ type: 'bytes' }], log.data);
  return message;
}

// ---------------------------------------------------------------------------
// Internal helpers using client directly
// ---------------------------------------------------------------------------

async function getSourceReceipt(client: ViemClient, txHash: Hex) {
  try {
    return await client.l2.getTransactionReceipt({ hash: txHash });
  } catch (e) {
    if (isReceiptNotFound(e)) return null;
    throw toZKsyncError(
      'RPC',
      {
        resource: 'interop',
        operation: OP_INTEROP.svc.status.sourceReceipt,
        message: 'Failed to fetch source L2 receipt for interop tx.',
        context: { where: 'l2.getTransactionReceipt', l2SrcTxHash: txHash },
      },
      e,
    );
  }
}

async function getDstLogs(
  client: ViemClient,
  topics: InteropTopics,
  args: { dstChainId: bigint; address: Address; topics: Hex[] },
): Promise<InteropLog[]> {
  return await wrap(
    OP_INTEROP.svc.status.dstLogs,
    async () => {
      const dstClient = client.requirePublicClient(args.dstChainId);
      const topic0 = args.topics?.[0]?.toLowerCase();
      const bundleHash = args.topics?.[1] as Hex | undefined;
      const eventByTopic: Record<string, AbiEvent> = {
        [topics.bundleUnbundled.toLowerCase()]: getAbiItem({
          abi: IInteropHandlerAbi,
          name: 'BundleUnbundled',
        }) as AbiEvent,
        [topics.bundleExecuted.toLowerCase()]: getAbiItem({
          abi: IInteropHandlerAbi,
          name: 'BundleExecuted',
        }) as AbiEvent,
        [topics.bundleVerified.toLowerCase()]: getAbiItem({
          abi: IInteropHandlerAbi,
          name: 'BundleVerified',
        }) as AbiEvent,
      };

      const event = topic0 ? eventByTopic[topic0] : undefined;
      const rawLogs =
        event && bundleHash
          ? await dstClient.getLogs({
            address: args.address,
            fromBlock: 0n,
            toBlock: 'latest',
            event,
            args: { bundleHash },
          })
          : await dstClient.getLogs({
            address: args.address,
            fromBlock: 0n,
            toBlock: 'latest',
          });

      return rawLogs.map((log) => ({
        address: log.address,
        topics: log.topics as Hex[],
        data: log.data,
        transactionHash: log.transactionHash,
      }));
    },
    {
      ctx: { dstChainId: args.dstChainId, address: args.address },
      message: 'Failed to query destination bundle lifecycle logs.',
    },
  );
}

async function readInteropRoot(
  client: ViemClient,
  args: { dstChainId: bigint; rootChainId: bigint; batchNumber: bigint },
): Promise<Hex | null> {
  const dstClient = await wrap(
    OP_INTEROP.svc.status.requireDstProvider,
    () => client.requirePublicClient(args.dstChainId),
    {
      ctx: { where: 'requirePublicClient', dstChainId: args.dstChainId },
      message: 'Failed to acquire destination provider.',
    },
  );

  return await dstClient.readContract({
    address: L2_INTEROP_ROOT_STORAGE_ADDRESS,
    abi: InteropRootStorageABI,
    functionName: 'interopRoots',
    args: [args.rootChainId, args.batchNumber],
  });
}

async function queryDstBundleLifecycle(
  client: ViemClient,
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
    return await getDstLogs(client, topics, {
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
  client: ViemClient,
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
  client: ViemClient,
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
  client: ViemClient,
  input: InteropWaitable,
): Promise<InteropStatus> {
  const topics = getTopics();
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
        decodeInteropBundleSent,
      },
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
  client: ViemClient,
  input: InteropWaitable,
  opts?: { pollMs?: number; timeoutMs?: number },
): Promise<InteropFinalizationInfo> {
  const topics = getTopics();
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
          decodeInteropBundleSent,
          decodeL1MessageData,
          bundleHash: ids.bundleHash,
          l2SrcTxHash: ids.l2SrcTxHash,
        },
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
  client: ViemClient,
  info: InteropFinalizationInfo,
): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }> {
  const topics = getTopics();
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

  const wallet = await wrap(
    OP_INTEROP.exec.sendStep,
    () => client.walletFor(dstChainId),
    {
      ctx: { dstChainId },
      message: 'Failed to resolve destination wallet.',
    },
  );

  const dstClient = await wrap(
    OP_INTEROP.svc.status.requireDstProvider,
    () => client.requirePublicClient(dstChainId),
    {
      ctx: { where: 'requirePublicClient', dstChainId },
      message: 'Failed to acquire destination provider.',
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

  try {
    const hash = await wallet.writeContract({
      address: interopHandler,
      abi: IInteropHandlerAbi as Abi,
      functionName: 'executeBundle',
      args: [encodedData, proof] as readonly unknown[],
      chain: dstClient.chain ?? null,
      account: client.account,
    });

    return {
      hash,
      wait: async () => {
        try {
          const receipt = (await dstClient.waitForTransactionReceipt({
            hash,
          })) as TransactionReceipt | null;

          if (!receipt || receipt.status !== 'success') {
            throw createStateError(
              OP_INTEROP.exec.waitStep,
              'Interop bundle execution reverted on destination.',
              { dstChainId, txHash: hash },
            );
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
    input: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;

  executeBundle(
    info: InteropFinalizationInfo,
  ): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }>;
}

export function createInteropFinalizationServices(
  client: ViemClient,
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

export async function status(client: ViemClient, h: InteropWaitable): Promise<InteropStatus> {
  return wrap(OP_INTEROP.status, () => deriveInteropStatus(client, h), {
    message: 'Internal error while checking interop status.',
    ctx: { where: 'interop.status' },
  });
}

export async function wait(
  client: ViemClient,
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

