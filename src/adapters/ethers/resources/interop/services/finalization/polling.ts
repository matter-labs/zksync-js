import type { AbstractProvider } from 'ethers';
import type { Hex } from '../../../../../../core/types/primitives';
import type {
  InteropWaitable,
  InteropFinalizationInfo,
} from '../../../../../../core/types/flows/interop';
import type { EthersClient } from '../../../../client';
import { createErrorHandlers } from '../../../../errors/error-ops';
import { createError } from '../../../../../../core/errors/factory';
import { OP_INTEROP } from '../../../../../../core/types';
import { isZKsyncError } from '../../../../../../core/types/errors';
import { ZERO_HASH } from '../../../../../../core/types/primitives';
import { sleep } from '../../../../../../core/utils';
import {
  resolveIdsFromWaitable,
  parseBundleReceiptInfo,
  buildFinalizationInfo,
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  type BundleReceiptInfo,
} from '../../../../../../core/resources/interop/finalization';
import { getTopics } from './topics';
import { decodeInteropBundleSent, decodeL1MessageData } from './decoders';
import { getInteropRoot } from './data-fetchers';
import { type ReceiptWithL2ToL1 } from '../../../../../../core/rpc/types';

const { wrap } = createErrorHandlers('interop');

function isProofNotReadyError(error: unknown): boolean {
  return isZKsyncError(error, {
    operation: 'zksrpc.getL2ToL1LogProof',
    messageIncludes: 'proof not yet available',
  });
}

function shouldRetryRootFetch(error: unknown): boolean {
  if (!isZKsyncError(error)) return false;
  return error.envelope.operation === OP_INTEROP.svc.status.getRoot;
}

async function waitForProof(
  client: EthersClient,
  l2SrcTxHash: Hex,
  logIndex: number,
  blockNumber: bigint,
  pollMs: number,
  deadline: number,
) {
  // Wait for the block to be finalized first
  while (true) {
    if (Date.now() > deadline) {
      throw createError('TIMEOUT', {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.timeout,
        message: 'Timed out waiting for block to be finalized.',
        context: { l2SrcTxHash, logIndex, blockNumber },
      });
    }

    const finalizedBlock = await client.l2.getBlock('finalized');
    if (finalizedBlock && BigInt(finalizedBlock.number) >= blockNumber) {
      break;
    }

    await sleep(pollMs);
  }

  // Block is finalized, poll proof until available.
  while (true) {
    if (Date.now() > deadline) {
      throw createError('TIMEOUT', {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.timeout,
        message: 'Timed out waiting for L2->L1 log proof to become available.',
        context: { l2SrcTxHash, logIndex },
      });
    }

    try {
      return await client.zks.getL2ToL1LogProof(l2SrcTxHash, logIndex);
    } catch (error) {
      if (!isProofNotReadyError(error)) throw error;
    }

    await sleep(pollMs);
  }
}

async function waitForRoot(
  provider: AbstractProvider,
  expectedRoot: { rootChainId: bigint; batchNumber: bigint; expectedRoot: Hex },
  pollMs: number,
  deadline: number,
): Promise<void> {
  while (true) {
    if (Date.now() > deadline) {
      throw createError('TIMEOUT', {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.timeout,
        message: 'Timed out waiting for interop root to become available.',
        context: { expectedRoot },
      });
    }

    let interopRoot: Hex | null = null;
    try {
      const root = await getInteropRoot(
        provider,
        expectedRoot.rootChainId,
        expectedRoot.batchNumber,
      );
      if (root !== ZERO_HASH) {
        interopRoot = root;
      }
    } catch (error) {
      if (!shouldRetryRootFetch(error)) throw error;
      interopRoot = null;
    }

    if (interopRoot) {
      if (interopRoot.toLowerCase() === expectedRoot.expectedRoot.toLowerCase()) {
        return;
      }
      throw createError('STATE', {
        resource: 'interop',
        operation: OP_INTEROP.wait,
        message: 'Interop root mismatch.',
        context: {
          expected: expectedRoot.expectedRoot,
          got: interopRoot,
        },
      });
    }

    await sleep(pollMs);
  }
}

async function waitForTxReceipt(
  client: EthersClient,
  txHash: Hex,
  pollMs: number,
  deadline: number,
): Promise<ReceiptWithL2ToL1> {
  while (true) {
    if (Date.now() > deadline) {
      throw createError('TIMEOUT', {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.timeout,
        message: 'Timed out waiting for source receipt to be available.',
        context: { txHash },
      });
    }

    const receipt = await wrap(
      OP_INTEROP.svc.status.sourceReceipt,
      () => client.zks.getReceiptWithL2ToL1(txHash),
      {
        ctx: { where: 'zks.getReceiptWithL2ToL1', txHash },
        message: 'Failed to fetch source L2 receipt (with L2->L1 logs) for interop tx.',
      },
    );

    if (receipt) {
      return receipt;
    }

    await sleep(pollMs);
  }
}

export async function waitForFinalization(
  client: EthersClient,
  dstProvider: AbstractProvider,
  input: InteropWaitable,
  opts?: { pollMs?: number; timeoutMs?: number },
): Promise<InteropFinalizationInfo> {
  const { topics, centerIface } = getTopics();
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  const ids = resolveIdsFromWaitable(input);
  if (!ids.l2SrcTxHash) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.sourceReceipt,
      message: 'Cannot wait for interop finalization: missing l2SrcTxHash.',
      context: { input },
    });
  }

  const { interopCenter } = await client.ensureAddresses();
  let bundleInfo: BundleReceiptInfo | null = null;
  while (!bundleInfo) {
    if (Date.now() > deadline) {
      throw createError('TIMEOUT', {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.timeout,
        message: 'Timed out waiting for source receipt to be available.',
        context: { l2SrcTxHash: ids.l2SrcTxHash },
      });
    }
    const txReceipt = await waitForTxReceipt(client, ids.l2SrcTxHash, pollMs, deadline);
    bundleInfo = parseBundleReceiptInfo({
      rawReceipt: txReceipt,
      interopCenter,
      interopBundleSentTopic: topics.interopBundleSent,
      decodeInteropBundleSent: (log) => decodeInteropBundleSent(centerIface, log),
      decodeL1MessageData,
      l2SrcTxHash: ids.l2SrcTxHash,
    });
  }

  const proof = await waitForProof(
    client,
    ids.l2SrcTxHash,
    bundleInfo.l2ToL1LogIndex,
    BigInt(bundleInfo.rawReceipt.blockNumber!),
    pollMs,
    deadline,
  );

  const finalizationInfo = buildFinalizationInfo(
    { l2SrcTxHash: ids.l2SrcTxHash, bundleHash: ids.bundleHash },
    bundleInfo,
    proof,
    bundleInfo.l1MessageData,
  );

  await waitForRoot(dstProvider, finalizationInfo.expectedRoot, pollMs, deadline);

  return finalizationInfo;
}
