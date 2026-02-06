import { Contract, type TransactionResponse, type TransactionReceipt } from 'ethers';
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
import { getDestinationLogs } from './data-fetchers';

const { wrap } = createErrorHandlers('interop');

export async function getBundleStatus(
  client: EthersClient,
  topics: InteropTopics,
  bundleHash: Hex,
  dstChainId: bigint,
): Promise<{ phase: InteropPhase; dstExecTxHash?: Hex }> {
  const { interopHandler } = await client.ensureAddresses();
  const fetchLogsFor = async (eventTopic: Hex) => {
    return await getDestinationLogs(client, dstChainId, interopHandler, [eventTopic, bundleHash]);
  };

  const unbundledLogs = await fetchLogsFor(topics.bundleUnbundled);
  if (unbundledLogs.length > 0) {
    const txHash = unbundledLogs.at(-1)!.transactionHash;
    return { phase: 'UNBUNDLED', dstExecTxHash: txHash };
  }

  const executedLogs = await fetchLogsFor(topics.bundleExecuted);
  if (executedLogs.length > 0) {
    const txHash = executedLogs.at(-1)!.transactionHash;
    return { phase: 'EXECUTED', dstExecTxHash: txHash };
  }

  const verifiedLogs = await fetchLogsFor(topics.bundleVerified);
  if (verifiedLogs.length > 0) {
    return { phase: 'VERIFIED' };
  }

  return { phase: 'SENT' };
}

export async function executeBundle(
  client: EthersClient,
  info: InteropFinalizationInfo,
): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }> {
  const { topics } = getTopics();
  const { bundleHash, dstChainId, encodedData, proof } = info;

  const dstStatus = await getBundleStatus(client, topics, bundleHash, dstChainId);

  if (['EXECUTED', 'UNBUNDLED'].includes(dstStatus.phase)) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.finalize,
      message: `Interop bundle has already been ${dstStatus.phase.toLowerCase()}.`,
      context: {
        bundleHash,
        dstChainId,
      },
    });
  }

  const signer = await wrap(OP_INTEROP.exec.sendStep, () => client.signerFor(dstChainId), {
    ctx: { dstChainId },
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
              context: { dstChainId, txHash: hash },
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
              context: { dstChainId, txHash: hash },
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
        context: { dstChainId },
      },
      e,
    );
  }
}
