// src/adapters/ethers/resources/interop/routes/types.ts
import type { TransactionRequest } from 'ethers';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';
import type { QuoteExtras } from '../../../../../core/types/flows/interop';

export interface InteropRouteStrategy {
  // Optional preflight checks. Throw with a descriptive message on invalid inputs.
  preflight?(params: InteropParams, ctx: BuildCtx): Promise<void> | void;

  // Build the plan steps + approvals + quote extras.
  build(
    params: InteropParams,
    ctx: BuildCtx,
  ): Promise<{
    steps: Array<PlanStep<TransactionRequest>>;
    approvals: ApprovalNeed[];
    quoteExtras: QuoteExtras;
  }>;
}
