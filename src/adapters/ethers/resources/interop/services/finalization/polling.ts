import type { AbstractProvider } from 'ethers';
import type {
  InteropFinalizationInfo,
  InteropWaitable,
} from '../../../../../../core/types/flows/interop';
import type { EthersClient } from '../../../../client';
import { createErrorHandlers } from '../../../../errors/error-ops';
import { createError } from '../../../../../../core/errors/factory';
import { isZKsyncError, OP_INTEROP } from '../../../../../../core/types/errors';
import {
  parseBundleReceiptInfo,
  resolveIdsFromWaitable,
  waitForBundleLifecycle,
} from '../../../../../../core/internal/cross-chain/bundle-lifecycle';
import { ProofTarget } from '../../../../../../core/rpc/zks';
import { decodeInteropBundleSent, decodeL1MessageData } from './decoders';
import { isBundleExecutable } from './bundle';
import { getTopics } from './topics';

const { wrap } = createErrorHandlers('interop');

function isProofNotReadyError(error: unknown): boolean {
  return isZKsyncError(error, {
    operation: 'zksrpc.getL2ToL1LogProof',
    messageIncludes: 'proof not yet available',
  });
}

export async function waitForFinalization(
  client: EthersClient,
  dstProvider: AbstractProvider,
  input: InteropWaitable,
  opts?: { pollMs?: number; timeoutMs?: number },
  requireExecutable = true,
): Promise<InteropFinalizationInfo> {
  const ids = resolveIdsFromWaitable(input);
  if (!ids.l2SrcTxHash) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.sourceReceipt,
      message: 'Cannot wait for interop finalization: missing l2SrcTxHash.',
      context: { input },
    });
  }

  const { topics, centerIface } = getTopics();
  const { interopCenter } = await client.ensureAddresses();

  return waitForBundleLifecycle({
    sourceTxHash: ids.l2SrcTxHash,
    expectedBundleHash: ids.bundleHash,
    options: opts,
    getSourceReceipt: (txHash) =>
      wrap(OP_INTEROP.svc.status.sourceReceipt, () => client.zks.getReceiptWithL2ToL1(txHash), {
        ctx: { where: 'zks.getReceiptWithL2ToL1', txHash },
        message: 'Failed to fetch source L2 receipt (with L2->L1 logs) for interop tx.',
      }),
    parseReceipt: (rawReceipt) =>
      parseBundleReceiptInfo({
        rawReceipt,
        interopCenter,
        interopBundleSentTopic: topics.interopBundleSent,
        decodeInteropBundleSent: (log) => decodeInteropBundleSent(centerIface, log),
        decodeL1MessageData,
        l2SrcTxHash: ids.l2SrcTxHash!,
      }),
    getFinalizedBlockNumber: async () => {
      const finalizedBlock = await client.l2.getBlock('finalized');
      return finalizedBlock ? BigInt(finalizedBlock.number) : null;
    },
    getProof: (txHash, logIndex) =>
      client.zks.getL2ToL1LogProof(txHash, logIndex, ProofTarget.MessageRoot),
    isProofNotReadyError,
    destination: requireExecutable
      ? {
          timeoutMessage: 'Timed out waiting for executeBundle to become ready on destination.',
          timeoutContext: (proof) => ({
            sourceBatchNumber: proof.batchNumber,
          }),
          isReady: (_proof, info) => isBundleExecutable(client, dstProvider, info),
        }
      : undefined,
  });
}
