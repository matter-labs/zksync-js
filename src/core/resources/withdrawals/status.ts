// src/core/resources/withdrawals/status.ts

import type { WithdrawalPhase } from '../../types/flows/withdrawals';

/**
 * Phases a withdrawal can never progress out of.
 *
 * `wait()` stops on these: `FINALIZED` because the funds are released, `UNFINALIZABLE` because the
 * message, chain or settlement path is permanently invalid, or the destination unwound the bundle
 * and cancelled its call. Polling either of them would never terminate on its own.
 */
export const TERMINAL_WITHDRAWAL_PHASES: readonly WithdrawalPhase[] = [
  'FINALIZED',
  'UNFINALIZABLE',
];

/** True when the withdrawal can never leave its current phase. */
export function isTerminalWithdrawalPhase(phase: WithdrawalPhase): boolean {
  return TERMINAL_WITHDRAWAL_PHASES.includes(phase);
}
