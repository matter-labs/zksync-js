import type { FinalizeReadiness } from '../../core/types/flows/withdrawals';

// TODO: should we make this more exhaustive?

/** Maps withdrawal revert reasons to readiness states. */
export const REVERT_TO_READINESS: Record<string, FinalizeReadiness> = {
  // Already done
  WithdrawalAlreadyFinalized: { kind: 'FINALIZED' },

  // Temporary — try later
  BatchNotExecuted: { kind: 'NOT_READY', reason: 'batch-not-executed' },
  LocalRootIsZero: { kind: 'NOT_READY', reason: 'root-missing' },

  // Permanent — won’t become ready for this tx
  WrongL2Sender: { kind: 'UNFINALIZABLE', reason: 'message-invalid' },
  InvalidSelector: { kind: 'UNFINALIZABLE', reason: 'message-invalid' },
  L2WithdrawalMessageWrongLength: { kind: 'UNFINALIZABLE', reason: 'message-invalid' },
  WrongMsgLength: { kind: 'UNFINALIZABLE', reason: 'message-invalid' },
  TokenNotLegacy: { kind: 'UNFINALIZABLE', reason: 'message-invalid' },
  TokenIsLegacy: { kind: 'UNFINALIZABLE', reason: 'message-invalid' },
  InvalidProof: { kind: 'UNFINALIZABLE', reason: 'message-invalid' },

  InvalidChainId: { kind: 'UNFINALIZABLE', reason: 'invalid-chain' },
  NotSettlementLayer: { kind: 'UNFINALIZABLE', reason: 'settlement-layer' },

  // Likely environment mismatch — treat as permanent for this tx
  OnlyEraSupported: { kind: 'UNFINALIZABLE', reason: 'unsupported' },
  LocalRootMustBeZero: { kind: 'UNFINALIZABLE', reason: 'unsupported' },
};
