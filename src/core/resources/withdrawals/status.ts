// src/core/resources/withdrawals/status.ts
import type { FinalizeReadiness, WithdrawalPhase } from '../../types/flows/withdrawals';
import { assertNever } from '../../utils';

// UNFINALIZABLE must not fold into PENDING: callers would poll a call that can never succeed.
export function phaseFromReadiness(r: FinalizeReadiness): {
  phase: WithdrawalPhase;
  reason?: string;
} {
  switch (r.kind) {
    case 'FINALIZED':
      return { phase: 'FINALIZED' };
    case 'READY':
      return { phase: 'READY_TO_FINALIZE' };
    case 'NOT_READY':
      return { phase: 'PENDING', reason: formatReason(r.reason, r.detail) };
    case 'UNFINALIZABLE':
      return { phase: 'UNFINALIZABLE', reason: formatReason(r.reason, r.detail) };
    default:
      return assertNever(r);
  }
}

const formatReason = (reason: string, detail?: string) =>
  detail ? `${reason}: ${detail}` : reason;
