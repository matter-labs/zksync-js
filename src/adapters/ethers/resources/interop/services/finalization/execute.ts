import { Contract, type TransactionReceipt } from 'ethers';
import type { Hex } from '../../../../../../core/types/primitives';
import type { InteropFinalizationInfo } from '../../../../../../core/types/flows/interop';
import type { EthersClient } from '../../../../client';
import { createErrorHandlers, toZKsyncError } from '../../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../../core/types';
import { createError } from '../../../../../../core/errors/factory';
import { isZKsyncError } from '../../../../../../core/types/errors';
import IInteropHandlerAbi from '../../../../../../core/internal/abis/IInteropHandler';
import { getTopics } from '../topics';
import { queryDstBundleLifecycle } from './lifecycle';

const { wrap } = createErrorHandlers('interop');

export async function executeInteropBundle(
  client: EthersClient,
  info: InteropFinalizationInfo,
): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }> {
  const { topics } = getTopics();
  const { bundleHash, dstChainId, encodedData, proof } = info;

  const dstStatus = await queryDstBundleLifecycle(client, topics, bundleHash, dstChainId);

  if (dstStatus.phase === 'EXECUTED') {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.finalize,
      message: 'Interop bundle has already been executed.',
      context: {
        bundleHash,
        dstChainId,
      },
    });
  }

  if (dstStatus.phase === 'UNBUNDLED') {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.finalize,
      message: 'Interop bundle has been unbundled and cannot be executed as a whole.',
      context: { bundleHash, dstChainId },
    });
  }

  const signer = await wrap(OP_INTEROP.exec.sendStep, () => client.signerFor(dstChainId), {
    ctx: { dstChainId },
    message: 'Failed to resolve destination signer.',
  });

  const { interopHandler } = await client.ensureAddresses();

  const handler = new Contract(interopHandler, IInteropHandlerAbi, signer) as Contract & {
    executeBundle: (
      bundle: Hex,
      proof: InteropFinalizationInfo['proof'],
    ) => Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }>;
  };

  try {
    const txResp = await handler.executeBundle(encodedData, proof);
    const hash = txResp.hash;

    return {
      hash,
      wait: async () => {
        try {
          const receipt = (await txResp.wait()) as TransactionReceipt | null;
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
