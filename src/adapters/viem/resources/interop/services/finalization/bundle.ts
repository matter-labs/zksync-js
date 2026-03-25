import { createWalletClient, custom, type PublicClient } from 'viem';
import type { Hex } from '../../../../../../core/types/primitives';
import type { InteropFinalizationInfo } from '../../../../../../core/types/flows/interop';
import type { ViemClient } from '../../../../client';
import { createErrorHandlers, toZKsyncError } from '../../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../../core/types';
import { createError } from '../../../../../../core/errors/factory';
import { isZKsyncError } from '../../../../../../core/types/errors';
import IInteropHandlerAbi from '../../../../../../core/internal/abis/IInteropHandler';
import { getTopics } from './topics';
import type { InteropPhase } from '../../../../../../core/types/flows/interop';
import type { InteropTopics } from '../../../../../../core/resources/interop/events';
import type { Log } from '../../../../../../core/types/transactions';
import { getLogs, type LogsQueryOptions } from './data-fetchers';

const { wrap } = createErrorHandlers('interop');

export async function getBundleStatus(
  client: ViemClient,
  dstProvider: PublicClient,
  topics: InteropTopics,
  bundleHash: Hex,
  opts?: LogsQueryOptions,
): Promise<{ phase: InteropPhase; dstExecTxHash?: Hex }> {
  const { interopHandler } = await client.ensureAddresses();
  // Single call: filter only by bundleHash (topic1), then classify via topic0 locally.
  const bundleLogs = await getLogs(dstProvider, interopHandler, [null, bundleHash], opts);

  const findLastByTopic = (eventTopic: Hex) =>
    bundleLogs.findLast((log: Log) => log.topics[0].toLowerCase() === eventTopic.toLowerCase());

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
  client: ViemClient,
  dstProvider: PublicClient,
  info: InteropFinalizationInfo,
  opts?: LogsQueryOptions,
): Promise<{ hash: Hex; wait: () => Promise<void> }> {
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

  const dstWallet = await wrap(
    OP_INTEROP.exec.sendStep,
    () =>
      createWalletClient({
        account: client.account,
        transport: custom(dstProvider.transport),
        chain: dstProvider.chain,
      }),
    { message: 'Failed to create destination wallet client.' },
  );

  const { interopHandler } = await client.ensureAddresses();

  try {
    const hash = await dstWallet.writeContract({
      address: interopHandler,
      abi: IInteropHandlerAbi,
      functionName: 'executeBundle',
      args: [encodedData, proof] as never,
      account: client.account,
      chain: dstProvider.chain ?? null,
    });

    return {
      hash: hash,
      wait: async () => {
        try {
          const receipt = await dstProvider.waitForTransactionReceipt({ hash });
          if (receipt.status === 'reverted') {
            throw createError('EXECUTION', {
              resource: 'interop',
              operation: OP_INTEROP.exec.waitStep,
              message: 'Interop bundle execution reverted on destination.',
              context: { txHash: hash },
            });
          }
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
    if (isZKsyncError(e)) throw e;
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
