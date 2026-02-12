import type { AbstractProvider } from 'ethers';
import type {
  InteropStatus,
  InteropWaitable,
  InteropPhase,
} from '../../../../../../core/types/flows/interop';
import type { Log } from '../../../../../../core/types/transactions';
import type { EthersClient } from '../../../../client';
import {
  resolveIdsFromWaitable,
  parseBundleSentFromReceipt,
} from '../../../../../../core/resources/interop/finalization';
import { getTopics } from './topics';
import { decodeInteropBundleSent } from './decoders';
import { getSourceReceipt } from './data-fetchers';
import { getBundleStatus } from './bundle';
import type { DestinationLogsQueryOptions } from './data-fetchers';

export async function getStatus(
  client: EthersClient,
  dstProvider: AbstractProvider,
  input: InteropWaitable,
  opts?: DestinationLogsQueryOptions,
): Promise<InteropStatus> {
  const { topics, centerIface } = getTopics();
  const baseIds = resolveIdsFromWaitable(input);

  const enrichedIds = await (async () => {
    if (baseIds.bundleHash) return baseIds;
    if (!baseIds.l2SrcTxHash) return baseIds;

    const { interopCenter } = await client.ensureAddresses();
    const receipt = await getSourceReceipt(client, baseIds.l2SrcTxHash);
    if (!receipt) return baseIds;

    const { bundleHash } = parseBundleSentFromReceipt({
      receipt: { logs: receipt.logs as Log[] },
      interopCenter,
      interopBundleSentTopic: topics.interopBundleSent,
      decodeInteropBundleSent: (log) => decodeInteropBundleSent(centerIface, log),
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
