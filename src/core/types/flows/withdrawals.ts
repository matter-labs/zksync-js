// src/types/flows/withdrawals.ts

import type { WithdrawalFeeBreakdown, TxOverrides } from '../fees';
import type { Address, Hex } from '../primitives';
import type { ApprovalNeed, Plan, Handle } from './base';
import type { WithdrawalBundleFinalization } from '../../resources/withdrawals/finalization';

/** Input */
export interface WithdrawParams {
  token: Address;
  amount: bigint;
  to?: Address;
  refundRecipient?: Address;
  l2TxOverrides?: TxOverrides;
}

/** Routes */
export type WithdrawRoute = 'base' | 'erc20-nonbase';

/** Quote */
export interface WithdrawQuote {
  route: WithdrawRoute;
  approvalsNeeded: readonly ApprovalNeed[];
  amounts: {
    transfer: { token: Address; amount: bigint };
  };
  fees: WithdrawalFeeBreakdown;
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
  /**
   * Hash of the withdrawal's interop bundle. Only present on protocol v32+ chains, where it — not
   * `(chainId, batch, messageIndex)` — is what identifies the withdrawal on L1.
   */
  bundleHash?: Hex;
};

/**
 * Protocol-tagged finalization arguments.
 *
 * v31 and v32 finalize withdrawals on different contracts with entirely different arguments, so the
 * derived parameters are a discriminated union rather than one widened shape:
 *
 * - `legacy-withdrawal` — `L1Nullifier.finalizeDeposit(FinalizeL1DepositParams)`
 * - `interop-bundle` — `L1InteropHandler.executeBundle(bundle, MessageInclusionProof)`
 */
export type WithdrawalFinalization =
  | { protocol: 'legacy-withdrawal'; params: FinalizeDepositParams }
  | { protocol: 'interop-bundle'; params: WithdrawalBundleFinalization };

/** Resolved finalization arguments together with the L1 contract they target. */
export interface ResolvedWithdrawalFinalization {
  /** The L1 contract to send the finalization to. */
  target: Address;
  finalization: WithdrawalFinalization;
  /** Identifying key, for status reporting. */
  key: WithdrawalKey;
}

export type WithdrawalPhase =
  | 'L2_PENDING' // tx not in an L2 block yet
  | 'L2_INCLUDED' // we have the L2 receipt
  | 'PENDING' // inclusion known; proof data not yet derivable/available
  | 'READY_TO_FINALIZE' // Ready to call finalize on L1
  | 'FINALIZING' // L1 tx sent but not picked up yet
  | 'FINALIZED' // L2-L1 tx finalized on L1
  | 'FINALIZE_FAILED' // prior L1 finalize reverted
  | 'UNFINALIZABLE' // permanently cannot finalize; see `reason`
  | 'UNKNOWN';

/** Phases from which a withdrawal can never progress. `wait()` stops on these. */
export const TERMINAL_WITHDRAWAL_PHASES = ['FINALIZED', 'UNFINALIZABLE'] as const;

export function isTerminalWithdrawalPhase(phase: WithdrawalPhase): boolean {
  return (TERMINAL_WITHDRAWAL_PHASES as readonly string[]).includes(phase);
}

// Withdrawal Status
export type WithdrawalStatus = {
  phase: WithdrawalPhase;
  l2TxHash: Hex;
  l1FinalizeTxHash?: Hex;
  key?: WithdrawalKey;
  /**
   * Why the withdrawal is `UNFINALIZABLE`. Carries the readiness reason from the L1 simulation, or
   * `bundle-cancelled` when the destination handler unwound the bundle and cancelled its call.
   */
  reason?: FinalizeUnfinalizableReason | 'bundle-cancelled';
};

/** Reasons a withdrawal can never be finalized. */
export type FinalizeUnfinalizableReason =
  | 'message-invalid'
  | 'invalid-chain'
  | 'settlement-layer'
  | 'unsupported';

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

// Finalization gas & fee estimate
export interface FinalizationEstimate {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}
