import { Contract, isError, type AbstractProvider } from 'ethers';
import type { Address, Hex } from '../../../../../../core/types/primitives';
import type { Log } from '../../../../../../core/types/transactions';
import type { EthersClient } from '../../../../client';
import { createErrorHandlers } from '../../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../../core/types';
import { InteropRootStorageABI } from '../../../../../../core/abi';
import { L2_INTEROP_ROOT_STORAGE_ADDRESS } from '../../../../../../core/constants';

const { wrap } = createErrorHandlers('interop');
const DEFAULT_BLOCKS_RANGE_SIZE = 10_000;
const DEFAULT_MAX_BLOCKS_BACK = 20_000;
const SAFE_BLOCKS_RANGE_SIZE = 1_000;

export interface DestinationLogsQueryOptions {
  maxBlocksBack?: number;
  logChunkSize?: number;
}

// Server returns an error if the there is a block range limit and the requested range exceeds it.
// The error returned in such case is UNKNOWN_ERROR with a message containing "query exceeds max block range {limit}".
function parseMaxBlockRangeLimit(error: unknown): number | null {
  if (!isError(error, 'UNKNOWN_ERROR')) return null;
  if (!error.error || typeof error.error !== 'object') return null;

  const match = /query exceeds max block range\s+(\d+)/i.exec(error.error?.message);
  if (!match) return null;

  const limit = Number.parseInt(match[1], 10);
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}

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
  dstProvider: AbstractProvider,
  address: Address,
  topics: Array<Hex | null>,
  opts?: DestinationLogsQueryOptions,
): Promise<Log[]> {
  const maxBlocksBack = opts?.maxBlocksBack ?? DEFAULT_MAX_BLOCKS_BACK;
  const initialChunkSize = opts?.logChunkSize ?? DEFAULT_BLOCKS_RANGE_SIZE;

  return await wrap(
    OP_INTEROP.svc.status.dstLogs,
    async () => {
      const currentBlock = await dstProvider.getBlockNumber();
      const minBlock = Math.max(0, currentBlock - maxBlocksBack);

      let toBlock = currentBlock;
      let chunkSize = initialChunkSize;

      while (toBlock >= minBlock) {
        const fromBlock = Math.max(minBlock, toBlock - chunkSize + 1);

        try {
          const rawLogs = await dstProvider.getLogs({
            address,
            topics,
            fromBlock,
            toBlock,
          });

          if (rawLogs.length > 0) {
            return rawLogs.map((log) => ({
              address: log.address as Address,
              topics: log.topics as Hex[],
              data: log.data as Hex,
              transactionHash: log.transactionHash as Hex,
            }));
          }

          toBlock = fromBlock - 1;
        } catch (error) {
          // If the error is due to exceeding the server's max block range, reduce the chunk size and retry.
          const serverLimit = parseMaxBlockRangeLimit(error);
          // If we can't determine the server limit, rethrow the error.
          if (serverLimit == null) {
            // In case the error message cannot be parsed or a different error message format is returned by
            // a provider, try once again with a small chunk size.
            if (chunkSize > SAFE_BLOCKS_RANGE_SIZE) {
              chunkSize = SAFE_BLOCKS_RANGE_SIZE;
            } else {
              throw error;
            }
          } else {
            chunkSize = Math.min(chunkSize, serverLimit);
          }
        }
      }

      return [];
    },
    {
      ctx: { address, maxBlocksBack, logChunkSize: initialChunkSize },
      message: 'Failed to query destination bundle lifecycle logs.',
    },
  );
}

export async function getInteropRoot(
  dstProvider: AbstractProvider,
  rootChainId: bigint,
  batchNumber: bigint,
): Promise<Hex> {
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
      ctx: { rootChainId, batchNumber },
      message: 'Failed to get interop root from the destination chain.',
    },
  );
}
