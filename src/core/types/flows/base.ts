// src/types/flows/base.ts

import type { Address, Hex } from '../primitives';

/** Generic approval requirement */
export interface ApprovalNeed {
  token: Address;
  spender: Address;
  amount: bigint;
}

/** Generic step (adapter injects Tx type) */
export interface PlanStep<Tx, Preview = undefined> {
  key: string;
  kind: string;
  description: string;
  /** Adapter-specific request (ethers TransactionRequest, viem WriteContractParameters, etc.) */
  tx: Tx;
  /** Optional compact, human-friendly view for logging/UI */
  preview?: Preview;
}

/** Generic plan */
export interface Plan<Tx, Route, Quote> {
  route: Route;
  summary: Quote;
  steps: Array<PlanStep<Tx>>;
}

/** Generic handle (returned by create()) */
export interface Handle<TxHashMap extends Record<string, Hex>, Route, PlanT> {
  kind: 'deposit' | 'withdrawal';
  route?: Route;
  stepHashes: TxHashMap; // step key -> tx hash
  plan: PlanT;
}

/** Waitable inputs */
export type Waitable<HashKey extends string = 'txHash'> =
  | Hex
  | Record<HashKey, Hex>
  | { [k in HashKey]?: Hex } // allows L1 or L2 forms
  | { stepHashes?: Record<string, Hex> };

// Common context for deposits and withdrawal flows
export interface CommonCtx {
  sender: Address;
  chainId: bigint;
}
