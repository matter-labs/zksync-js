import { Interface, type Log, type Provider, type TransactionReceipt } from 'ethers';
import type { Hex } from '../../../../../core/types/primitives';
import { isHash66 } from '../../../../../core/utils/hash';
import { TOPIC_CANONICAL_ASSIGNED, TOPIC_CANONICAL_SUCCESS } from '../../../../../core/constants';
import { waitForPriorityLifecycle } from '../../../../../core/internal/cross-chain/priority-lifecycle';

// Event ABI for Bridgehub's NewPriorityRequest
export const I_BRIDGEHUB = new Interface([
  'event NewPriorityRequest(uint256 indexed chainId, address indexed sender, bytes32 txHash, uint256 txId, bytes data)',
]);
// topic0 for Bridgehub.NewPriorityRequest
export const TOPIC_BRIDGEHUB_NPR = I_BRIDGEHUB.getEvent('NewPriorityRequest')!.topicHash;

// Extracts the L2 transaction hash from L1 logs emitted by Bridgehub during deposit
// Returns null if not found
export function getL2TransactionHashFromLogs(logs: ReadonlyArray<Log>): Hex | null {
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
  knownL1Receipt?: TransactionReceipt,
): Promise<{ l2Receipt: TransactionReceipt; l2TxHash: Hex }> {
  const result = await waitForPriorityLifecycle({
    sourceTxHash: l1TxHash,
    target: 'destination',
    waitForSourceReceipt: () =>
      knownL1Receipt ? Promise.resolve(knownL1Receipt) : l1.waitForTransaction(l1TxHash),
    deriveDestinationTxHash: (receipt) => getL2TransactionHashFromLogs(receipt.logs),
    waitForDestinationReceipt: (l2TxHash) => l2.waitForTransaction(l2TxHash),
    getDestinationReceipt: (l2TxHash) => l2.getTransactionReceipt(l2TxHash).catch(() => null),
    isDestinationReceiptSuccessful: (receipt) => receipt.status === 1,
  });

  if (!result.destinationReceipt || !result.destinationTxHash) {
    throw new Error('No L1 receipt found');
  }
  return {
    l2Receipt: result.destinationReceipt,
    l2TxHash: result.destinationTxHash,
  };
}
