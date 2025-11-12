// src/adapters/viem/resources/deposits/services/verification.ts

import type { PublicClient, TransactionReceipt, Log, AbiEvent } from 'viem';
import type { Hex } from '../../../../../core/types/primitives';
import { decodeEventLog } from 'viem';
import { isHash66 } from '../../../../../core/utils/addr';
import { TOPIC_CANONICAL_ASSIGNED, TOPIC_CANONICAL_SUCCESS } from '../../../../../core/constants';
import { createError } from '../../../../../core/errors/factory';

// Event ABI for Bridgehub's NewPriorityRequest
const I_BRIDGEHUB_NEW_PRIORITY_REQUEST = {
  type: 'event',
  name: 'NewPriorityRequest',
  inputs: [
    { name: 'chainId', type: 'uint256', indexed: true },
    { name: 'sender', type: 'address', indexed: true },
    { name: 'txHash', type: 'bytes32', indexed: false },
    { name: 'txId', type: 'uint256', indexed: false },
    { name: 'data', type: 'bytes', indexed: false },
  ],
} as const satisfies AbiEvent;

// Extracts the L2 transaction hash from L1 logs emitted by Bridgehub during deposit
// Returns null if not found
export function extractL2TxHashFromL1Logs(logs: ReadonlyArray<Log>): Hex | null {
  for (const lg of logs) {
    try {
      const parsed = decodeEventLog({
        abi: [I_BRIDGEHUB_NEW_PRIORITY_REQUEST],
        data: lg.data,
        topics: lg.topics,
        strict: false,
      });
      if (parsed?.eventName === 'NewPriorityRequest') {
        const h = (parsed.args as { txHash?: Hex })?.txHash;
        if (h && isHash66(h)) return h;
      }
    } catch {
      // ignore
    }
  }

  // Fallback
  for (const lg of logs) {
    const t0 = ((lg.topics?.[0] as Hex) ?? '0x').toLowerCase();
    if (t0 === TOPIC_CANONICAL_ASSIGNED.toLowerCase()) {
      const h = lg.topics?.[2];
      if (h && isHash66(h)) return h;
    }
    if (t0 === TOPIC_CANONICAL_SUCCESS.toLowerCase()) {
      const h = lg.topics?.[3];
      if (h && isHash66(h)) return h;
    }
  }

  return null;
}

// Waits for the L2 transaction corresponding to the given L1 transaction to be executed
// Throws if the L2 transaction fails or cannot be found
export async function waitForL2ExecutionFromL1Tx(
  l1: PublicClient,
  l2: PublicClient,
  l1TxHash: Hex,
): Promise<{ l2Receipt: TransactionReceipt; l2TxHash: Hex }> {
  // Wait for L1 receipt
  const l1Receipt = await l1.waitForTransactionReceipt({ hash: l1TxHash });
  if (!l1Receipt) throw new Error('No L1 receipt found');

  // Extract L2 tx hash from logs
  const l2TxHash = extractL2TxHashFromL1Logs(l1Receipt.logs as ReadonlyArray<Log>);
  if (!l2TxHash) {
    throw createError('VERIFICATION', {
      message: 'Failed to extract L2 transaction hash from L1 logs',
      resource: 'deposits',
      operation: 'deposits.wait',
      context: { l1TxHash, logCount: l1Receipt.logs?.length ?? 0 },
    });
  }

  // Wait for L2 execution
  let l2Receipt = await l2.waitForTransactionReceipt({ hash: l2TxHash }).catch(() => null);

  // double-check in case the provider’s wait returned null but the receipt exists now
  if (!l2Receipt) {
    const maybe = await l2.getTransactionReceipt({ hash: l2TxHash }).catch(() => null);
    if (!maybe) {
      throw createError('VERIFICATION', {
        message: 'L2 transaction was not found after waiting for its execution',
        resource: 'deposits',
        operation: 'deposits.wait',
        context: { l1TxHash, l2TxHash, where: 'l2.waitForTransactionReceipt' },
      });
    }
    l2Receipt = maybe;
  }

  if (l2Receipt.status !== 'success') {
    throw createError('VERIFICATION', {
      message: 'L2 transaction execution failed',
      resource: 'deposits',
      operation: 'deposits.wait',
      context: { l1TxHash, l2TxHash, status: l2Receipt.status },
    });
  }

  return { l2Receipt, l2TxHash };
}
