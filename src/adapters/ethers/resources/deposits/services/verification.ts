import { Interface, type Log, type Provider, type TransactionReceipt } from 'ethers';
import type { Hex } from '../../../../../core/types/primitives';
import { isHash66 } from '../../../../../core/utils/hash';
import { TOPIC_CANONICAL_ASSIGNED, TOPIC_CANONICAL_SUCCESS } from '../../../../../core/constants';

import { createError } from '../../../../../core/errors/factory.ts';

// Event ABI for Bridgehub's NewPriorityRequest
export const I_BRIDGEHUB = new Interface([
  'event NewPriorityRequest(uint256 indexed chainId, address indexed sender, bytes32 txHash, uint256 txId, bytes data)',
]);
// topic0 for Bridgehub.NewPriorityRequest
export const TOPIC_BRIDGEHUB_NPR = I_BRIDGEHUB.getEvent('NewPriorityRequest')!.topicHash;

// Extracts the L2 transaction hash from L1 logs emitted by Bridgehub during deposit
// Returns null if not found
export function extractL2TxHashFromL1Logs(logs: ReadonlyArray<Log>): Hex | null {
  for (const lg of logs) {
    if ((lg.topics?.[0] ?? '').toLowerCase() === TOPIC_BRIDGEHUB_NPR.toLowerCase()) {
      try {
        const ev = I_BRIDGEHUB.decodeEventLog('NewPriorityRequest', lg.data, lg.topics);
        const h = ev.txHash as string;
        if (isHash66(h)) return h;
      } catch {
        // ignore
      }
    }
  }
  // Fallback
  for (const lg of logs) {
    const t0 = (lg.topics?.[0] ?? '').toLowerCase();
    if (t0 === TOPIC_CANONICAL_ASSIGNED.toLowerCase()) {
      const h = lg.topics?.[2];
      if (isHash66(h)) return h;
    }
    if (t0 === TOPIC_CANONICAL_SUCCESS.toLowerCase()) {
      const h = lg.topics?.[3];
      if (isHash66(h)) return h;
    }
  }

  return null;
}

// Waits for the L2 transaction corresponding to the given L1 transaction to be executed
// Throws if the L2 transaction fails or cannot be found
export async function waitForL2ExecutionFromL1Tx(
  l1: Provider,
  l2: Provider,
  l1TxHash: Hex,
): Promise<{ l2Receipt: TransactionReceipt; l2TxHash: Hex }> {
  const l1Receipt = await l1.waitForTransaction(l1TxHash);
  if (!l1Receipt) throw new Error('No L1 receipt found');

  const l2TxHash = extractL2TxHashFromL1Logs(l1Receipt.logs);
  if (!l2TxHash) {
    throw createError('VERIFICATION', {
      message: 'Failed to extract L2 transaction hash from L1 logs',
      resource: 'deposits',
      operation: 'deposits.wait',
      context: { l1TxHash, logCount: l1Receipt.logs?.length ?? 0 },
    });
  }

  const l2Receipt = await l2.waitForTransaction(l2TxHash);
  if (!l2Receipt) {
    // double-check in case the provider’s wait returned null but the receipt exists now
    const maybe = await l2.getTransactionReceipt(l2TxHash).catch(() => null);
    if (!maybe) {
      throw createError('VERIFICATION', {
        message: 'L2 transaction was not found after waiting for its execution',
        resource: 'deposits',
        operation: 'deposits.wait',
        context: { l1TxHash, l2TxHash, where: 'l2.waitForTransaction' },
      });
    }

    if (maybe.status !== 1) {
      throw createError('VERIFICATION', {
        message: 'L2 transaction execution failed',
        resource: 'deposits',
        operation: 'deposits.wait',
        context: { l1TxHash, l2TxHash, status: maybe.status },
      });
    }
    return { l2Receipt: maybe, l2TxHash };
  }

  return { l2Receipt, l2TxHash };
}
