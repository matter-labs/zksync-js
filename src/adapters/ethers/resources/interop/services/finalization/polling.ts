import type { Hex } from '../../../../../../core/types/primitives';
import type {
  InteropWaitable,
  InteropFinalizationInfo,
} from '../../../../../../core/types/flows/interop';
import type { EthersClient } from '../../../../client';

import { createErrorHandlers } from '../../../../errors/error-ops';
import { createError } from '../../../../../../core/errors/factory';
import { OP_INTEROP } from '../../../../../../core/types';
import { ZERO_HASH } from '../../../../../../core/types/primitives';
import { sleep } from '../../../../../../core/utils';
import {
  resolveIdsFromWaitable,
  parseBundleReceiptInfo,
  buildFinalizationInfo,
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
} from '../../../../../../core/resources/interop/finalization';
import { getTopics } from '../topics';
import { decodeInteropBundleSent, decodeL1MessageData } from './decoders';
import { getInteropRoot } from './data-fetchers';

const { wrap } = createErrorHandlers('interop');

async function waitForLogProof(
  client: EthersClient,
  l2SrcTxHash: Hex,
  logIndex: number,
  blockNumber: bigint,
  pollMs: number,
  deadlineMs: number,
) {
  // Wait for the block to be finalized first
  while (true) {
    if (Date.now() > deadlineMs) {
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

  // Block is finalized, fetch the proof
  return await client.zks.getL2ToL1LogProof(l2SrcTxHash, logIndex);
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
      throw createError('TIMEOUT', {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.timeout,
        message: 'Timed out waiting for interop root to become available.',
        context: { dstChainId, expectedRoot },
      });
    }

    let interopRoot: Hex | null = null;
    try {
      const root = await getInteropRoot(client,
        dstChainId,
        expectedRoot.rootChainId,
        expectedRoot.batchNumber,
      );
      if (root !== ZERO_HASH) {
        interopRoot = root;
      }
    } catch {
      interopRoot = null;
    }

    if (interopRoot) {
      if (interopRoot.toLowerCase() === expectedRoot.expectedRoot.toLowerCase()) {
        return;
      }
      throw createError('STATE', {
        resource: 'interop',
        operation: OP_INTEROP.wait,
        message: 'Interop root mismatch on destination chain.',
        context: {
          expected: expectedRoot.expectedRoot,
          got: interopRoot,
          dstChainId,
        },
      });
    }

    await sleep(pollMs);
  }
}

export async function waitForInteropFinalization(
  client: EthersClient,
  input: InteropWaitable,
  opts?: { pollMs?: number; timeoutMs?: number },
): Promise<InteropFinalizationInfo> {
  const { topics, centerIface } = getTopics();
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadlineMs = Date.now() + timeoutMs;

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
  let bundleInfo: Awaited<ReturnType<typeof parseBundleReceiptInfo>> | null = null;
  while (!bundleInfo) {
    if (Date.now() > deadlineMs) {
      throw createError('TIMEOUT', {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.timeout,
        message: 'Timed out waiting for source receipt to be available.',
        context: { l2SrcTxHash: ids.l2SrcTxHash },
      });
    }

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

    bundleInfo = parseBundleReceiptInfo({
      rawReceipt,
      interopCenter,
      interopBundleSentTopic: topics.interopBundleSent,
      decodeInteropBundleSent: (log) => decodeInteropBundleSent(centerIface, log),
      decodeL1MessageData,
      l2SrcTxHash: ids.l2SrcTxHash,
    });
  }

  const proof = await waitForLogProof(
    client,
    ids.l2SrcTxHash,
    bundleInfo.l2ToL1LogIndex,
    BigInt(bundleInfo.rawReceipt.blockNumber!),
    pollMs,
    deadlineMs,
  );

  const info = buildFinalizationInfo(
    { l2SrcTxHash: ids.l2SrcTxHash, bundleHash: ids.bundleHash },
    bundleInfo,
    proof,
    bundleInfo.l1MessageData,
  );

  await waitUntilRootAvailable(
    client,
    bundleInfo.dstChainId,
    info.expectedRoot,
    pollMs,
    deadlineMs,
  );

  return info;
}
