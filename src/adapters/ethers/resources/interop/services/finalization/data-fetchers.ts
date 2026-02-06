import { Contract } from 'ethers';
import type { Address, Hex } from '../../../../../../core/types/primitives';
import type { Log } from '../../../../../../core/types/transactions';
import type { EthersClient } from '../../../../client';
import { createErrorHandlers } from '../../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../../core/types';
import { InteropRootStorageABI } from '../../../../../../core/abi';
import { L2_INTEROP_ROOT_STORAGE_ADDRESS } from '../../../../../../core/constants';

const { wrap } = createErrorHandlers('interop');

export async function getSourceReceipt(client: EthersClient, txHash: Hex) {
  const receipt = await wrap(
    OP_INTEROP.svc.status.sourceReceipt,
    () => client.l2.getTransactionReceipt(txHash),
    {
      ctx: { where: 'l2.getTransactionReceipt', l2SrcTxHash: txHash },
      message: 'Failed to fetch source L2 receipt for interop tx.',
    },
  );
  if (!receipt) return null;
  return {
    logs: receipt.logs.map((log) => ({
      address: log.address as Address,
      topics: log.topics as Hex[],
      data: log.data as Hex,
      transactionHash: log.transactionHash as Hex,
    })),
  };
}

export async function getDestinationLogs(
  client: EthersClient,
  dstChainId: bigint, address: Address, topics: Hex[],
): Promise<Log[]> {
  return await wrap(
    OP_INTEROP.svc.status.dstLogs,
    async () => {
      const dstProvider = client.requireProvider(dstChainId);
      const rawLogs = await dstProvider.getLogs({
        address,
        fromBlock: 0n,
        toBlock: 'latest',
        topics,
      });

      return rawLogs.map((log) => ({
        address: log.address as Address,
        topics: log.topics as Hex[],
        data: log.data as Hex,
        transactionHash: log.transactionHash as Hex,
      }));
    },
    {
      ctx: { dstChainId, address },
      message: 'Failed to query destination bundle lifecycle logs.',
    },
  );
}

export async function getInteropRoot(
  client: EthersClient,
  dstChainId: bigint, rootChainId: bigint, batchNumber: bigint,
): Promise<Hex> {
  const dstProvider = await wrap(
    OP_INTEROP.svc.status.requireDstProvider,
    () => client.requireProvider(dstChainId),
    {
      ctx: { where: 'requireProvider', dstChainId },
      message: 'Failed to acquire destination provider.',
    },
  );

  const rootStorage = new Contract(
    L2_INTEROP_ROOT_STORAGE_ADDRESS,
    InteropRootStorageABI,
    dstProvider,
  ) as Contract & {
    interopRoots: (chainId: bigint, batchNumber: bigint) => Promise<Hex>;
  };

  return await rootStorage.interopRoots(rootChainId, batchNumber);
}
