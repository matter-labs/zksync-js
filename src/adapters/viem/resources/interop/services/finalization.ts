import type { TransactionReceipt, Abi, AbiEvent } from 'viem';
import { decodeEventLog, getAbiItem, getEventSelector } from 'viem';

import type { Address, Hex } from '../../../../../core/types/primitives';
import type { ViemClient } from '../../../client';
import type {
  InteropStatus,
  InteropWaitable,
  InteropFinalizationInfo,
} from '../../../../../core/types/flows/interop';

import { createErrorHandlers, toZKsyncError } from '../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../core/types';
import { createError } from '../../../../../core/errors/factory';
import { isZKsyncError, isReceiptNotFound } from '../../../../../core/types/errors';
import type { InteropFinalizationDeps } from '../../../../../core/resources/interop/finalization';
import {
  deriveInteropStatus,
  waitForInteropFinalization,
  executeInteropBundle,
} from '../../../../../core/resources/interop/finalization';
import { InteropRootStorageABI } from '../../../../../core/abi';
import { L2_INTEROP_ROOT_STORAGE_ADDRESS } from '../../../../../core/constants';

// ABIs we need to decode events / send executeBundle()
import InteropCenterAbi from '../../../../../core/internal/abis/InteropCenter';
import IInteropHandlerAbi from '../../../../../core/internal/abis/IInteropHandler';

// error handling
const { wrap } = createErrorHandlers('interop');

function eventTopic(abi: unknown, name: string): Hex {
  const item = getAbiItem({ abi: abi as any, name });
  return getEventSelector(item as any) as Hex;
}

function createDeps(client: ViemClient): InteropFinalizationDeps {
  const topics = {
    interopBundleSent: eventTopic(InteropCenterAbi, 'InteropBundleSent'),
    bundleVerified: eventTopic(IInteropHandlerAbi, 'BundleVerified'),
    bundleExecuted: eventTopic(IInteropHandlerAbi, 'BundleExecuted'),
    bundleUnbundled: eventTopic(IInteropHandlerAbi, 'BundleUnbundled'),
  } as const;

  return {
    topics,
    async getInteropAddresses() {
      const { interopCenter, interopHandler } = await wrap(
        OP_INTEROP.svc.status.ensureAddresses,
        () => client.ensureAddresses(),
        {
          ctx: { where: 'ensureAddresses' },
          message: 'Failed to ensure interop addresses.',
        },
      );
      return { interopCenter, interopHandler };
    },

    async getSourceReceipt(txHash) {
      try {
        return await client.l2.getTransactionReceipt({ hash: txHash });
      } catch (e) {
        if (isReceiptNotFound(e)) return null;
        throw toZKsyncError(
          'RPC',
          {
            resource: 'interop',
            operation: OP_INTEROP.svc.status.sourceReceipt,
            message: 'Failed to fetch source L2 receipt for interop tx.',
            context: { where: 'l2.getTransactionReceipt', l2SrcTxHash: txHash },
          },
          e,
        );
      }
    },

    async getReceiptWithL2ToL1(txHash) {
      return await wrap(
        OP_INTEROP.svc.status.sourceReceipt,
        () => client.zks.getReceiptWithL2ToL1(txHash),
        {
          ctx: { where: 'zks.getReceiptWithL2ToL1', l2SrcTxHash: txHash },
          message: 'Failed to fetch source L2 receipt (with L2->L1 logs) for interop tx.',
        },
      );
    },

    async getL2ToL1LogProof(txHash, logIndex) {
      return client.zks.getL2ToL1LogProof(txHash, logIndex);
    },

    async getDstLogs(args) {
      return await wrap(
        OP_INTEROP.svc.status.dstLogs,
        async () => {
          const dstClient = client.requirePublicClient(args.dstChainId);
          const topic0 = args.topics?.[0]?.toLowerCase();
          const bundleHash = args.topics?.[1] as Hex | undefined;
          const eventByTopic: Record<string, AbiEvent> = {
            [topics.bundleUnbundled.toLowerCase()]: getAbiItem({
              abi: IInteropHandlerAbi,
              name: 'BundleUnbundled',
            }) as AbiEvent,
            [topics.bundleExecuted.toLowerCase()]: getAbiItem({
              abi: IInteropHandlerAbi,
              name: 'BundleExecuted',
            }) as AbiEvent,
            [topics.bundleVerified.toLowerCase()]: getAbiItem({
              abi: IInteropHandlerAbi,
              name: 'BundleVerified',
            }) as AbiEvent,
          };

          const event = topic0 ? eventByTopic[topic0] : undefined;
          const rawLogs = event && bundleHash
            ? await dstClient.getLogs({
                address: args.address,
                fromBlock: 0n,
                toBlock: 'latest',
                event,
                args: { bundleHash },
              })
            : await dstClient.getLogs({
                address: args.address,
                fromBlock: 0n,
                toBlock: 'latest',
              });

          return rawLogs.map((log) => ({
            address: log.address as Address,
            topics: log.topics as Hex[],
            data: log.data as Hex,
            transactionHash: log.transactionHash as Hex,
          }));
        },
        {
          ctx: { dstChainId: args.dstChainId, address: args.address },
          message: 'Failed to query destination bundle lifecycle logs.',
        },
      );
    },

    async readInteropRoot(args) {
      const dstClient = await wrap(
        OP_INTEROP.svc.status.requireDstProvider,
        () => client.requirePublicClient(args.dstChainId),
        {
          ctx: { where: 'requirePublicClient', dstChainId: args.dstChainId },
          message: 'Failed to acquire destination provider.',
        },
      );

      return (await dstClient.readContract({
        address: L2_INTEROP_ROOT_STORAGE_ADDRESS,
        abi: InteropRootStorageABI,
        functionName: 'interopRoots',
        args: [args.rootChainId, args.batchNumber],
      })) as Hex;
    },

    async executeBundle(args) {
      const wallet = await wrap(
        OP_INTEROP.exec.sendStep,
        () => client.walletFor(args.dstChainId),
        {
          ctx: { dstChainId: args.dstChainId },
          message: 'Failed to resolve destination wallet.',
        },
      );

      const dstClient = await wrap(
        OP_INTEROP.svc.status.requireDstProvider,
        () => client.requirePublicClient(args.dstChainId),
        {
          ctx: { where: 'requirePublicClient', dstChainId: args.dstChainId },
          message: 'Failed to acquire destination provider.',
        },
      );

      const { interopHandler } = await wrap(
        OP_INTEROP.svc.status.ensureAddresses,
        () => client.ensureAddresses(),
        {
          ctx: { where: 'ensureAddresses' },
          message: 'Failed to ensure interop handler address.',
        },
      );

      try {
        const hash = await wallet.writeContract({
          address: interopHandler,
          abi: IInteropHandlerAbi as Abi,
          functionName: 'executeBundle',
          args: [args.encodedData, args.proof] as readonly unknown[],
          chain: dstClient.chain ?? null,
          account: client.account,
        });

        return {
          hash,
          wait: async () => {
            try {
              const receipt = (await dstClient.waitForTransactionReceipt({
                hash,
              })) as TransactionReceipt | null;

              if (!receipt || receipt.status !== 'success') {
                throw createError('EXECUTION', {
                  resource: 'interop',
                  operation: OP_INTEROP.exec.waitStep,
                  message: 'Interop bundle execution reverted on destination.',
                  context: { dstChainId: args.dstChainId, txHash: hash },
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
                  message:
                    'Failed while waiting for executeBundle transaction on destination.',
                  context: { dstChainId: args.dstChainId, txHash: hash },
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
            context: { dstChainId: args.dstChainId },
          },
          e,
        );
      }
    },

    decodeInteropBundleSent(log) {
      const decoded = decodeEventLog({
        abi: InteropCenterAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      }) as {
        eventName: 'InteropBundleSent';
        args: {
          interopBundleHash: Hex;
          interopBundle: {
            sourceChainId: bigint;
            destinationChainId: bigint;
          };
        };
      };

      return {
        bundleHash: decoded.args.interopBundleHash,
        sourceChainId: decoded.args.interopBundle.sourceChainId,
        destinationChainId: decoded.args.interopBundle.destinationChainId,
      };
    },
  };
}

export interface InteropFinalizationServices {
  deriveStatus(input: InteropWaitable): Promise<InteropStatus>;

  waitForFinalization(
    input: InteropWaitable | Hex | InteropFinalizationInfo,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;

  executeBundle(
    info: InteropFinalizationInfo,
  ): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }>;
}

export function createInteropFinalizationServices(
  client: ViemClient,
): InteropFinalizationServices {
  const deps = createDeps(client);

  return {
    async deriveStatus(input) {
      return await deriveInteropStatus(deps, input);
    },

    async waitForFinalization(input, opts) {
      return await waitForInteropFinalization(deps, input, opts);
    },

    async executeBundle(info) {
      const result = await executeInteropBundle(deps, info);
      return {
        hash: result.hash,
        wait: async () => {
          const receipt = await result.wait();
          return receipt as TransactionReceipt;
        },
      };
    },
  };
}

export async function status(client: ViemClient, h: InteropWaitable): Promise<InteropStatus> {
  const svc = createInteropFinalizationServices(client);
  return wrap(OP_INTEROP.status, () => svc.deriveStatus(h), {
    message: 'Internal error while checking interop status.',
    ctx: { where: 'interop.status' },
  });
}

export async function wait(
  client: ViemClient,
  h: InteropWaitable,
  opts?: { for?: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
): Promise<InteropFinalizationInfo> {
  const svc = createInteropFinalizationServices(client);

  return wrap(
    OP_INTEROP.wait,
    () =>
      svc.waitForFinalization(h, {
        pollMs: opts?.pollMs,
        timeoutMs: opts?.timeoutMs,
      }),
    {
      message: 'Internal error while waiting for interop finalization.',
      ctx: { where: 'interop.wait', for: opts?.for },
    },
  );
}
