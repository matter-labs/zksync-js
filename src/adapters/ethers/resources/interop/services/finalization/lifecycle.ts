import type { Hex } from '../../../../../../core/types/primitives';
import type { InteropPhase } from '../../../../../../core/types/flows/interop';
import type { InteropTopics } from '../../../../../../core/resources/interop/events';
import type { EthersClient } from '../../../../client';

import { createErrorHandlers } from '../../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../../core/types';
import { getDestinationLogs } from './data-fetchers';

const { wrap } = createErrorHandlers('interop');

export async function queryDstBundleLifecycle(
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
    return await getDestinationLogs(client, dstChainId, interopHandler, [eventTopic, bundleHash]);
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
