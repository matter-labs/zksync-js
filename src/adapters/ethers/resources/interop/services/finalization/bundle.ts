import {
  Contract,
  type AbstractProvider,
  type TransactionResponse,
  type TransactionReceipt,
} from 'ethers';
import type { Hex } from '../../../../../../core/types/primitives';
import type { InteropFinalizationInfo } from '../../../../../../core/types/flows/interop';
import type { EthersClient } from '../../../../client';
import { createErrorHandlers, toZKsyncError } from '../../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../../core/types';
import { createError } from '../../../../../../core/errors/factory';
import { isZKsyncError } from '../../../../../../core/types/errors';
import IInteropHandlerAbi from '../../../../../../core/internal/abis/IInteropHandler';
import { getTopics } from './topics';
import type { InteropPhase } from '../../../../../../core/types/flows/interop';
import type { InteropTopics } from '../../../../../../core/resources/interop/events';
import { getDestinationLogs, type DestinationLogsQueryOptions } from './data-fetchers';

const { wrap } = createErrorHandlers('interop');

export async function getBundleStatus(
  client: EthersClient,
  dstProvider: AbstractProvider,
  topics: InteropTopics,
  bundleHash: Hex,
  opts?: DestinationLogsQueryOptions,
): Promise<{ phase: InteropPhase; dstExecTxHash?: Hex }> {
  const { interopHandler } = await client.ensureAddresses();
  // Single call: filter only by bundleHash (topic1), then classify via topic0 locally.
  const bundleLogs = await getDestinationLogs(
    dstProvider,
    interopHandler,
    [null, bundleHash],
    opts,
  );

  const findLastByTopic = (eventTopic: Hex) =>
    bundleLogs.findLast((log) => log.topics[0].toLowerCase() === eventTopic.toLowerCase());

  const lifecycleChecks: Array<{ phase: InteropPhase; topic: Hex; includeTxHash?: boolean }> = [
    { phase: 'UNBUNDLED', topic: topics.bundleUnbundled, includeTxHash: true },
    { phase: 'EXECUTED', topic: topics.bundleExecuted, includeTxHash: true },
    { phase: 'VERIFIED', topic: topics.bundleVerified },
  ];

  for (const check of lifecycleChecks) {
    const match = findLastByTopic(check.topic);
    if (!match) continue;

    if (check.includeTxHash) {
      return { phase: check.phase, dstExecTxHash: match.transactionHash };
    }
    return { phase: check.phase };
  }

  return { phase: 'SENT' };
}

export async function executeBundle(
  client: EthersClient,
  dstProvider: AbstractProvider,
  info: InteropFinalizationInfo,
  opts?: DestinationLogsQueryOptions,
): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }> {
  const { topics } = getTopics();
  const { bundleHash, encodedData, proof } = info;

  const dstStatus = await getBundleStatus(client, dstProvider, topics, bundleHash, opts);

  if (['EXECUTED', 'UNBUNDLED'].includes(dstStatus.phase)) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.finalize,
      message: `Interop bundle has already been ${dstStatus.phase.toLowerCase()}.`,
      context: { bundleHash },
    });
  }

  const signer = await wrap(OP_INTEROP.exec.sendStep, () => client.signerFor(dstProvider), {
    message: 'Failed to resolve destination signer.',
  });

  const { interopHandler } = await client.ensureAddresses();

  const handler = new Contract(interopHandler, IInteropHandlerAbi, signer);
  try {
    const txResponse = (await handler.executeBundle(encodedData, proof)) as TransactionResponse;
    const hash = txResponse.hash as Hex;
    return {
      hash,
      wait: async () => {
        try {
          const receipt = await txResponse.wait();
          if (!receipt || receipt.status !== 1) {
            throw createError('EXECUTION', {
              resource: 'interop',
              operation: OP_INTEROP.exec.waitStep,
              message: 'Interop bundle execution reverted on destination.',
              context: { txHash: hash },
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
              context: { txHash: hash },
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
      },
      e,
    );
  }
}
