import type { PublicClient } from 'viem';
import type {
  InteropStatus,
  InteropWaitable,
  InteropPhase,
} from '../../../../../../core/types/flows/interop';
import type { Log } from '../../../../../../core/types/transactions';
import type { ViemClient } from '../../../../client';
import {
  resolveIdsFromWaitable,
  parseBundleSentFromReceipt,
} from '../../../../../../core/resources/interop/finalization';
import { getTopics } from './topics';
import { decodeInteropBundleSent } from './decoders';
import { getTxReceipt } from './data-fetchers';
import { getBundleStatus } from './bundle';
import type { LogsQueryOptions } from './data-fetchers';

export async function getStatus(
  client: ViemClient,
  dstProvider: PublicClient,
  input: InteropWaitable,
  opts?: LogsQueryOptions,
): Promise<InteropStatus> {
  const { topics } = getTopics();
  const baseIds = resolveIdsFromWaitable(input);

  const enrichedIds = await (async () => {
    if (baseIds.bundleHash) return baseIds;
    if (!baseIds.l2SrcTxHash) return baseIds;

    const { interopCenter } = await client.ensureAddresses();
    const receipt = await getTxReceipt(client.l2, baseIds.l2SrcTxHash);
    if (!receipt) return baseIds;

    const { bundleHash } = parseBundleSentFromReceipt({
      receipt: { logs: receipt.logs as Log[] },
      interopCenter,
      interopBundleSentTopic: topics.interopBundleSent,
      decodeInteropBundleSent: (log) => decodeInteropBundleSent(log),
    });

    return { ...baseIds, bundleHash };
  })();

  if (!enrichedIds.bundleHash) {
    const phase: InteropPhase = enrichedIds.l2SrcTxHash ? 'SENT' : 'UNKNOWN';
    return {
      phase,
      l2SrcTxHash: enrichedIds.l2SrcTxHash,
      bundleHash: enrichedIds.bundleHash,
      dstExecTxHash: enrichedIds.dstExecTxHash,
    };
  }

  const dstInfo = await getBundleStatus(client, dstProvider, topics, enrichedIds.bundleHash, opts);

  return {
    phase: dstInfo.phase,
    l2SrcTxHash: enrichedIds.l2SrcTxHash,
    bundleHash: enrichedIds.bundleHash,
    dstExecTxHash: dstInfo.dstExecTxHash ?? enrichedIds.dstExecTxHash,
  };
}
