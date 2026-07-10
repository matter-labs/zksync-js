import type { PublicClient } from 'viem';
import type { InteropStatus, InteropWaitable } from '../../../../../../core/types/flows/interop';
import type { ViemClient } from '../../../../client';
import {
  inspectBundleLifecycle,
  mapBundleStateToInteropPhase,
  resolveIdsFromWaitable,
  parseBundleSentFromReceipt,
} from '../../../../../../core/internal/cross-chain/bundle-lifecycle';
import { getTopics } from './topics';
import { decodeInteropBundleSent } from './decoders';
import { getTxReceipt } from './data-fetchers';
import { findBundleDestinationTxHash, readBundleStatus } from './bundle';
import type { LogsQueryOptions } from './data-fetchers';

export async function getStatus(
  client: ViemClient,
  dstProvider: PublicClient,
  input: InteropWaitable,
  opts?: LogsQueryOptions,
): Promise<InteropStatus> {
  const { topics } = getTopics();
  const baseIds = resolveIdsFromWaitable(input);
  const { interopCenter } = await client.ensureAddresses();
  const inspection = await inspectBundleLifecycle({
    sourceTxHash: baseIds.l2SrcTxHash,
    bundleHash: baseIds.bundleHash,
    destinationTxHash: baseIds.dstExecTxHash,
    getSourceReceipt: (sourceTxHash) => getTxReceipt(client.l2, sourceTxHash),
    parseBundleSent: (receipt) =>
      parseBundleSentFromReceipt({
        receipt,
        interopCenter,
        interopBundleSentTopic: topics.interopBundleSent,
        decodeInteropBundleSent,
      }),
    readBundleStatus: (bundleHash) => readBundleStatus(client, dstProvider, bundleHash),
    findDestinationTxHash: (bundleHash, state) =>
      findBundleDestinationTxHash(client, dstProvider, topics, bundleHash, state, opts),
  });

  return {
    phase: mapBundleStateToInteropPhase(inspection.state, Boolean(inspection.sourceTxHash)),
    l2SrcTxHash: inspection.sourceTxHash,
    bundleHash: inspection.bundleHash,
    dstExecTxHash: inspection.destinationTxHash,
  };
}
