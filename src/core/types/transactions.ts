// src/core/types/transactions.ts
import type { Address, Hex } from './primitives';

// Generic transaction log type.
export type Log = {
  address: Address;
  topics: Hex[];
  data: Hex;
  transactionHash: Hex;
};

// Generic transaction receipt type containing logs.
export type TxReceipt = {
  logs: Log[];
};
