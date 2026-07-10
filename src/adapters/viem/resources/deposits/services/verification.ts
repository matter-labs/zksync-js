// src/adapters/viem/resources/deposits/services/verification.ts

import type { PublicClient, TransactionReceipt, Log, AbiEvent } from 'viem';
import type { Hex } from '../../../../../core/types/primitives';
import { decodeEventLog } from 'viem';
import { isHash66 } from '../../../../../core/utils/hash';
import { TOPIC_CANONICAL_ASSIGNED, TOPIC_CANONICAL_SUCCESS } from '../../../../../core/constants';
import { waitForPriorityLifecycle } from '../../../../../core/internal/cross-chain/priority-lifecycle';

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
export function getL2TransactionHashFromLogs(logs: ReadonlyArray<Log>): Hex | null {
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
  knownL1Receipt?: TransactionReceipt,
): Promise<{ l2Receipt: TransactionReceipt; l2TxHash: Hex }> {
  const result = await waitForPriorityLifecycle({
    sourceTxHash: l1TxHash,
    target: 'destination',
    waitForSourceReceipt: () =>
      knownL1Receipt
        ? Promise.resolve(knownL1Receipt)
        : l1.waitForTransactionReceipt({ hash: l1TxHash }),
    deriveDestinationTxHash: (receipt) =>
      getL2TransactionHashFromLogs(receipt.logs as ReadonlyArray<Log>),
    waitForDestinationReceipt: (l2TxHash) =>
      l2.waitForTransactionReceipt({ hash: l2TxHash }).catch(() => null),
    getDestinationReceipt: (l2TxHash) =>
      l2.getTransactionReceipt({ hash: l2TxHash }).catch(() => null),
    isDestinationReceiptSuccessful: (receipt) => receipt.status === 'success',
  });

  if (!result.destinationReceipt || !result.destinationTxHash) {
    throw new Error('No L1 receipt found');
  }
  return {
    l2Receipt: result.destinationReceipt,
    l2TxHash: result.destinationTxHash,
  };
}
