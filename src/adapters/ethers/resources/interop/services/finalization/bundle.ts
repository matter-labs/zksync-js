import {
  Contract,
  type AbstractProvider,
  type TransactionResponse,
  type TransactionReceipt,
} from 'ethers';
import type { Hex } from '../../../../../../core/types/primitives';
import type { InteropFinalizationInfo } from '../../../../../../core/types/flows/interop';
import type { TxGasOverrides } from '../../../../../../core/types/fees';
import type { EthersClient } from '../../../../client';
import { createErrorHandlers, toZKsyncError } from '../../../../errors/error-ops';
import { decodeRevert } from '../../../../errors/revert';
import { OP_INTEROP } from '../../../../../../core/types';
import { createError } from '../../../../../../core/errors/factory';
import { isZKsyncError } from '../../../../../../core/types/errors';
import IInteropHandlerAbi from '../../../../../../core/internal/abis/IInteropHandler';
import { getTopics } from './topics';
import type { InteropPhase } from '../../../../../../core/types/flows/interop';
import type { InteropTopics } from '../../../../../../core/resources/interop/events';
import { getLogs, type LogsQueryOptions } from './data-fetchers';
import {
  decodeBundleStatus,
  mapBundleStateToInteropPhase,
  type BundleLifecycleState,
} from '../../../../../../core/internal/cross-chain/bundle-lifecycle';

const { wrap } = createErrorHandlers('interop');

export async function getBundleStatus(
  client: EthersClient,
  dstProvider: AbstractProvider,
  topics: InteropTopics,
  bundleHash: Hex,
  opts?: LogsQueryOptions,
): Promise<{ phase: InteropPhase; dstExecTxHash?: Hex }> {
  const state = decodeBundleStatus(await readBundleStatus(client, dstProvider, bundleHash));
  const dstExecTxHash = await findBundleDestinationTxHash(
    client,
    dstProvider,
    topics,
    bundleHash,
    state,
    opts,
  );
  return { phase: mapBundleStateToInteropPhase(state), dstExecTxHash };
}

export async function readBundleStatus(
  client: EthersClient,
  dstProvider: AbstractProvider,
  bundleHash: Hex,
): Promise<bigint> {
  const { interopHandler } = await client.ensureAddresses();
  const handler = new Contract(interopHandler, IInteropHandlerAbi, dstProvider);
  return wrap(
    OP_INTEROP.svc.status.derive,
    async () => (await handler.bundleStatus(bundleHash)) as bigint,
    {
      ctx: { interopHandler, bundleHash },
      message: 'Failed to read bundle status from the destination interop handler.',
    },
  );
}

export async function findBundleDestinationTxHash(
  client: EthersClient,
  dstProvider: AbstractProvider,
  topics: InteropTopics,
  bundleHash: Hex,
  state: BundleLifecycleState,
  opts?: LogsQueryOptions,
): Promise<Hex | undefined> {
  if (state !== 'FULLY_EXECUTED' && state !== 'UNBUNDLED') return undefined;

  const { interopHandler } = await client.ensureAddresses();
  const bundleLogs = await getLogs(dstProvider, interopHandler, [null, bundleHash], opts);
  const eventTopic = state === 'FULLY_EXECUTED' ? topics.bundleExecuted : topics.bundleUnbundled;
  return bundleLogs.findLast((log) => log.topics[0]?.toLowerCase() === eventTopic.toLowerCase())
    ?.transactionHash;
}

export async function isBundleExecutable(
  client: EthersClient,
  dstProvider: AbstractProvider,
  info: InteropFinalizationInfo,
): Promise<boolean> {
  const state = decodeBundleStatus(await readBundleStatus(client, dstProvider, info.bundleHash));
  if (state === 'FULLY_EXECUTED') return true;
  if (state === 'UNBUNDLED') {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.wait.poll,
      message: 'Interop bundle was unbundled and cannot be executed atomically.',
      context: { bundleHash: info.bundleHash },
    });
  }

  const signer = await wrap(OP_INTEROP.svc.wait.poll, () => client.signerFor(dstProvider), {
    message: 'Failed to resolve destination signer for bundle readiness simulation.',
  });
  const { interopHandler } = await client.ensureAddresses();
  const handler = new Contract(interopHandler, IInteropHandlerAbi, signer);

  try {
    await handler.executeBundle.staticCall(info.encodedData, info.proof);
    return true;
  } catch (error) {
    if (decodeRevert(error)?.name === 'MessageNotIncluded') return false;
    throw toZKsyncError(
      'STATE',
      {
        resource: 'interop',
        operation: OP_INTEROP.svc.wait.poll,
        message: 'Destination handler rejected executeBundle readiness simulation.',
        context: { bundleHash: info.bundleHash, interopHandler },
      },
      error,
    );
  }
}

export async function executeBundle(
  client: EthersClient,
  dstProvider: AbstractProvider,
  info: InteropFinalizationInfo,
  opts?: LogsQueryOptions,
  txOverrides?: TxGasOverrides,
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
    const txResponse = (await handler.executeBundle(
      encodedData,
      proof,
      txOverrides ?? {},
    )) as TransactionResponse;
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

/** @deprecated Use atomic `executeBundle` through `interop.finalize`. */
export async function verifyBundle(
  client: EthersClient,
  dstProvider: AbstractProvider,
  info: InteropFinalizationInfo,
): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }> {
  const signer = await wrap(OP_INTEROP.verify, () => client.signerFor(dstProvider), {
    message: 'Failed to resolve destination signer for verifyBundle.',
  });
  const { interopHandler } = await client.ensureAddresses();
  const handler = new Contract(interopHandler, IInteropHandlerAbi, signer);
  try {
    const txResponse = (await handler.verifyBundle(
      info.encodedData,
      info.proof,
    )) as TransactionResponse;
    const hash = txResponse.hash as Hex;
    return {
      hash,
      wait: async () => {
        try {
          const receipt = await txResponse.wait();
          if (!receipt || receipt.status !== 1) {
            throw createError('EXECUTION', {
              resource: 'interop',
              operation: OP_INTEROP.verify,
              message: 'Interop bundle verification reverted on destination.',
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
              operation: OP_INTEROP.verify,
              message: 'Failed while waiting for verifyBundle transaction on destination.',
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
        operation: OP_INTEROP.verify,
        message: 'Failed to send verifyBundle transaction on destination chain.',
      },
      e,
    );
  }
}
