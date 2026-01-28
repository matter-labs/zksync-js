// src/adapters/ethers/resources/deposits/routes/types.ts
import type { TransactionRequest } from 'ethers';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';

// // An Interop route strategy for building an interop transaction request
// export type InteropRouteStrategy = RouteStrategy<
//   InteropParams,
//   TransactionRequest,
//   InteropFeeBreakdown,
//   BuildCtx
// >;

/** Quote add-ons a route can compute */
export interface QuoteExtras {
  /** Sum of msg.value across actions (sendNative + call.value). */
  totalActionValue: bigint;
  /** Sum of ERC-20 amounts across actions (for approvals/bridging). */
  bridgedTokenTotal: bigint;
}

export interface InteropRouteStrategy {
  /** Optional preflight checks. Throw with a descriptive message on invalid inputs. */
  preflight?(p: InteropParams, ctx: BuildCtx): Promise<void> | void;

  /** Build the plan steps + approvals + quote extras. */
  build(
    p: InteropParams,
    ctx: BuildCtx,
  ): Promise<{
    steps: Array<PlanStep<TransactionRequest>>;
    approvals: ApprovalNeed[];
    quoteExtras: QuoteExtras;
  }>;
}
