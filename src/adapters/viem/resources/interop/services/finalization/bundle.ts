import { createWalletClient, custom, type PublicClient, type TransactionReceipt } from 'viem';
import type { Hex } from '../../../../../../core/types/primitives';
import type { InteropFinalizationInfo } from '../../../../../../core/types/flows/interop';
import type { TxGasOverrides } from '../../../../../../core/types/fees';
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
import {
  decodeBundleStatus,
  mapBundleStateToInteropPhase,
  type BundleLifecycleState,
} from '../../../../../../core/internal/cross-chain/bundle-lifecycle';

const { wrap } = createErrorHandlers('interop');

export async function getBundleStatus(
  client: ViemClient,
  dstProvider: PublicClient,
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
  client: ViemClient,
  dstProvider: PublicClient,
  bundleHash: Hex,
): Promise<number> {
  const { interopHandler } = await client.ensureAddresses();
  return wrap(
    OP_INTEROP.svc.status.derive,
    async () =>
      Number(
        await dstProvider.readContract({
          address: interopHandler,
          abi: IInteropHandlerAbi,
          functionName: 'bundleStatus',
          args: [bundleHash],
        }),
      ),
    {
      ctx: { interopHandler, bundleHash },
      message: 'Failed to read bundle status from the destination interop handler.',
    },
  );
}

export async function findBundleDestinationTxHash(
  client: ViemClient,
  dstProvider: PublicClient,
  topics: InteropTopics,
  bundleHash: Hex,
  state: BundleLifecycleState,
  opts?: LogsQueryOptions,
): Promise<Hex | undefined> {
  if (state !== 'FULLY_EXECUTED' && state !== 'UNBUNDLED') return undefined;

  const { interopHandler } = await client.ensureAddresses();
  const bundleLogs = await getLogs(dstProvider, interopHandler, [null, bundleHash], opts);
  const eventTopic = state === 'FULLY_EXECUTED' ? topics.bundleExecuted : topics.bundleUnbundled;
  return bundleLogs.findLast(
    (log: Log) => log.topics[0]?.toLowerCase() === eventTopic.toLowerCase(),
  )?.transactionHash;
}

export async function executeBundle(
  client: ViemClient,
  dstProvider: PublicClient,
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
      gas: txOverrides?.gasLimit,
      maxFeePerGas: txOverrides?.maxFeePerGas,
      maxPriorityFeePerGas: txOverrides?.maxPriorityFeePerGas,
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
  client: ViemClient,
  dstProvider: PublicClient,
  info: InteropFinalizationInfo,
): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }> {
  const { interopHandler } = await client.ensureAddresses();
  const dstWallet = await wrap(
    OP_INTEROP.verify,
    () =>
      createWalletClient({
        account: client.account,
        transport: custom(dstProvider.transport),
        chain: dstProvider.chain,
      }),
    { message: 'Failed to create destination wallet client for verifyBundle.' },
  );
  try {
    const hash = await dstWallet.writeContract({
      address: interopHandler,
      abi: IInteropHandlerAbi,
      functionName: 'verifyBundle',
      args: [info.encodedData, info.proof] as never,
      account: client.account,
      chain: dstProvider.chain ?? null,
    });

    return {
      hash,
      wait: async () => {
        try {
          const receipt = await dstProvider.waitForTransactionReceipt({ hash });
          if (receipt.status === 'reverted') {
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
