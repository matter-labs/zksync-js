// src/core/withdrawals/logs.ts
import { L1_MESSENGER_ADDRESS } from '../../constants';
import type { ReceiptWithL2ToL1 } from '../../rpc/types';

// Finds the index of the L2->L1 log emitted by the messenger contract in a transaction receipt.
export function messengerLogIndex(
  raw: ReceiptWithL2ToL1,
  opts?: { index?: number; messenger?: string },
): number {
  const index = opts?.index ?? 0;
  const messenger = (opts?.messenger ?? L1_MESSENGER_ADDRESS).toLowerCase();

  const arr = Array.isArray(raw?.l2ToL1Logs) ? raw.l2ToL1Logs : [];
  const hits = arr
    .map((lg, i) => ({ i, lg }))
    .filter(({ lg }) => (lg?.sender ?? '').toLowerCase() === messenger);

  if (!hits.length) {
    throw new Error('No L2->L1 messenger logs found in receipt.');
  }

  // Legacy-aligned: take the provided index when available, otherwise first hit.
  return (hits[index] ?? hits[0]).i;
}
