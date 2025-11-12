// src/types/flows/withdrawals.ts

import type { Address, Hex } from '../primitives';
import type { ApprovalNeed, Plan, Handle, Eip1559GasOverrides, ResolvedEip1559Fees } from './base';

/** Input */
export interface WithdrawParams {
  token: Address;
  amount: bigint;
  to?: Address;
  l2GasLimit?: bigint;
  l2TxOverrides?: Eip1559GasOverrides;
}

/** Routes */
export type WithdrawRoute = 'eth-base' | 'erc20-nonbase' | 'eth-nonbase';

/** Quote */
export interface WithdrawQuote {
  route: WithdrawRoute;
  approvalsNeeded: readonly ApprovalNeed[];
  suggestedL2GasLimit: bigint;
  fees: ResolvedEip1559Fees;
}

/** Plan (Tx generic) */
export type WithdrawPlan<Tx> = Plan<Tx, WithdrawRoute, WithdrawQuote>;

/** Handle */
export interface WithdrawHandle<Tx>
  extends Handle<Record<string, Hex>, WithdrawRoute, WithdrawPlan<Tx>> {
  kind: 'withdrawal';
  l2TxHash: Hex;
  l1TxHash?: Hex;
  l2BatchNumber?: number;
  l2MessageIndex?: number;
  l2TxNumberInBatch?: number;
}

/** Waitable */
export type WithdrawalWaitable = Hex | { l2TxHash?: Hex; l1TxHash?: Hex } | WithdrawHandle<unknown>;

export interface FinalizeDepositParams {
  chainId: bigint;
  l2BatchNumber: bigint;
  l2MessageIndex: bigint;
  l2Sender: Address;
  l2TxNumberInBatch: number;
  message: Hex;
  merkleProof: Hex[];
}

export type WithdrawalKey = {
  chainIdL2: bigint;
  l2BatchNumber: bigint;
  l2MessageIndex: bigint;
};

type WithdrawalPhase =
  | 'L2_PENDING' // tx not in an L2 block yet
  | 'L2_INCLUDED' // we have the L2 receipt
  | 'PENDING' // inclusion known; proof data not yet derivable/available
  | 'READY_TO_FINALIZE' // Ready to call finalize on L1
  | 'FINALIZING' // L1 tx sent but not picked up yet
  | 'FINALIZED' // L2-L1 tx finalized on L1
  | 'FINALIZE_FAILED' // prior L1 finalize reverted
  | 'UNKNOWN';

// Withdrawal Status
export type WithdrawalStatus = {
  phase: WithdrawalPhase;
  l2TxHash: Hex;
  l1FinalizeTxHash?: Hex;
  key?: WithdrawalKey;
};

// Finalization readiness states
// Used for `status()`
export type FinalizeReadiness =
  | { kind: 'READY' }
  | { kind: 'FINALIZED' }
  | {
      kind: 'NOT_READY';
      // temporary, retry later
      reason: 'paused' | 'batch-not-executed' | 'root-missing' | 'unknown';
      detail?: string;
    }
  | {
      kind: 'UNFINALIZABLE';
      // permanent, won’t become ready
      reason: 'message-invalid' | 'invalid-chain' | 'settlement-layer' | 'unsupported';
      detail?: string;
    };

// Parsed L1 receipt and logs
export type ParsedLog = {
  address: string;
  topics: Hex[];
  data: Hex;
};

// Parsed L1 receipt
export type ParsedReceipt = {
  logs: ParsedLog[];
};
