// src/adapters/viem/resources/interop/routes/types.ts
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';
import type { QuoteExtras, InteropFee } from '../../../../../core/types/flows/interop';

/** Minimal transaction request for a viem L2 interop step. */
export interface ViemTransactionRequest {
  to?: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface InteropRouteStrategy {
  // Preflight checks. Throw with a descriptive message on invalid inputs.
  preflight(params: InteropParams, ctx: BuildCtx): Promise<void>;

  // Build the plan steps + approvals + quote extras.
  build(
    params: InteropParams,
    ctx: BuildCtx,
  ): Promise<{
    steps: Array<PlanStep<ViemTransactionRequest>>;
    approvals: ApprovalNeed[];
    quoteExtras: QuoteExtras;
    interopFee: InteropFee;
  }>;
}
