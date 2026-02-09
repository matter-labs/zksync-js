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
  dstChainId: bigint,
  address: Address,
  topics: Hex[],
): Promise<Log[]> {
  // Resolve provider outside the wrapped call so configuration errors are not masked as RPC issues.
  const dstProvider = client.requireProvider(dstChainId);
  return await wrap(
    OP_INTEROP.svc.status.dstLogs,
    async () => {
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
  dstChainId: bigint,
  rootChainId: bigint,
  batchNumber: bigint,
): Promise<Hex> {
  // Resolve provider outside the wrapped call so configuration errors are not masked as RPC issues.
  const dstProvider = client.requireProvider(dstChainId);
  return await wrap(
    OP_INTEROP.svc.status.getRoot,
    async () => {
      const rootStorage = new Contract(
        L2_INTEROP_ROOT_STORAGE_ADDRESS,
        InteropRootStorageABI,
        dstProvider,
      );

      return (await rootStorage.interopRoots(rootChainId, batchNumber)) as Hex;
    },
    {
      ctx: { dstChainId, rootChainId, batchNumber },
      message: 'Failed to get interop root from the destination chain.',
    },
  );
}
