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

export async function getStatus(
  client: EthersClient,
  input: InteropWaitable,
): Promise<InteropStatus> {
  const { topics, centerIface } = getTopics();
  const baseIds = resolveIdsFromWaitable(input);

  const enrichedIds = await (async () => {
    if (baseIds.bundleHash && baseIds.dstChainId) return baseIds;
    if (!baseIds.l2SrcTxHash) return baseIds;

    const { interopCenter } = await client.ensureAddresses();
    const receipt = await getSourceReceipt(client, baseIds.l2SrcTxHash);
    if (!receipt) return baseIds;

    const { bundleHash, dstChainId } = parseBundleSentFromReceipt({
      receipt: { logs: receipt.logs as Log[] },
      interopCenter,
      interopBundleSentTopic: topics.interopBundleSent,
      decodeInteropBundleSent: (log) => decodeInteropBundleSent(centerIface, log),
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

  const dstInfo = await getBundleStatus(
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
