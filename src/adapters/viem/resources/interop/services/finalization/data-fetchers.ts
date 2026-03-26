import type { PublicClient, Abi } from 'viem';
import { numberToHex } from 'viem';
import type { Address, Hex } from '../../../../../../core/types/primitives';
import type { Log } from '../../../../../../core/types/transactions';
import { createErrorHandlers } from '../../../../errors/error-ops';
import { isReceiptNotFound } from '../../../../../../core/types/errors';
import { OP_INTEROP } from '../../../../../../core/types';
import { IInteropRootStorageABI } from '../../../../../../core/abi';
import { L2_INTEROP_ROOT_STORAGE_ADDRESS } from '../../../../../../core/constants';

const { wrap } = createErrorHandlers('interop');
const DEFAULT_BLOCKS_RANGE_SIZE = 10_000;
const DEFAULT_MAX_BLOCKS_BACK = 20_000;
const SAFE_BLOCKS_RANGE_SIZE = 1_000;

export interface LogsQueryOptions {
  maxBlocksBack?: number;
  logChunkSize?: number;
}

/** Parse max block range limit from a viem getLogs error message. */
function parseMaxBlockRangeLimit(error: unknown): number | null {
  const msg =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message)
      : String(error);

  const match = /query exceeds max block range\s+(\d+)/i.exec(msg);
  if (!match) return null;

  const limit = Number.parseInt(match[1], 10);
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}

export async function getTxReceipt(provider: PublicClient, txHash: Hex) {
  const receipt = await wrap(
    OP_INTEROP.svc.status.sourceReceipt,
    async () => {
      try {
        return await provider.getTransactionReceipt({ hash: txHash });
      } catch (error) {
        if (isReceiptNotFound(error)) return null;
        throw error;
      }
    },
    {
      ctx: { where: 'l2.getTransactionReceipt', l2SrcTxHash: txHash },
      message: 'Failed to fetch source L2 receipt for interop tx.',
    },
  );
  if (!receipt) return null;
  return {
    logs: receipt.logs.map((log) => ({
      address: log.address,
      topics: log.topics as Hex[],
      data: log.data,
      transactionHash: log.transactionHash,
    })),
  };
}

export async function getLogs(
  provider: PublicClient,
  address: Address,
  topics: Array<Hex | null>,
  opts?: LogsQueryOptions,
): Promise<Log[]> {
  const maxBlocksBack = opts?.maxBlocksBack ?? DEFAULT_MAX_BLOCKS_BACK;
  const initialChunkSize = opts?.logChunkSize ?? DEFAULT_BLOCKS_RANGE_SIZE;

  return await wrap(
    OP_INTEROP.svc.status.dstLogs,
    async () => {
      const currentBlock = await provider.getBlockNumber();
      const minBlock = BigInt(Math.max(0, Number(currentBlock) - maxBlocksBack));

      let toBlock = currentBlock;
      let chunkSize = initialChunkSize;

      while (toBlock >= minBlock) {
        const fromBlock =
          toBlock - BigInt(chunkSize) + 1n > minBlock ? toBlock - BigInt(chunkSize) + 1n : minBlock;

        try {
          // viem's getLogs() ignores user-provided raw topics — it only generates
          // topics from typed `event`/`events` ABI. Use eth_getLogs directly so
          // the topics filter ([null, bundleHash]) is forwarded to the RPC call.
          const rawLogs = await provider.request({
            method: 'eth_getLogs',
            params: [
              {
                address,
                topics,
                fromBlock: numberToHex(fromBlock),
                toBlock: numberToHex(toBlock),
              },
            ],
          });

          if (rawLogs.length > 0) {
            return rawLogs.map((log) => ({
              address: log.address,
              topics: log.topics as Hex[],
              data: log.data,
              transactionHash: log.transactionHash as Hex,
            }));
          }

          toBlock = fromBlock - 1n;
        } catch (error) {
          const serverLimit = parseMaxBlockRangeLimit(error);
          if (serverLimit == null) {
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
  provider: PublicClient,
  rootChainId: bigint,
  batchNumber: bigint,
): Promise<Hex> {
  return await wrap(
    OP_INTEROP.svc.status.getRoot,
    async () => {
      return (await provider.readContract({
        address: L2_INTEROP_ROOT_STORAGE_ADDRESS,
        abi: IInteropRootStorageABI as Abi,
        functionName: 'interopRoots',
        args: [rootChainId, batchNumber],
      })) as Hex;
    },
    {
      ctx: { rootChainId, batchNumber },
      message: 'Failed to get interop root from the destination chain.',
    },
  );
}
