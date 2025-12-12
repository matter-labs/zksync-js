// src/types/flows/route.ts

import type { ApprovalNeed, PlanStep } from './base';

// Generic strategy contract for any flow
export interface RouteStrategy<P, Tx, FeeBreakdown = unknown, Ctx = unknown> {
  /** Optional preflight to refine route / sanity checks. */
  preflight?(p: P, ctx: Ctx): Promise<void>;

  /** Build plan (tx steps + approvals). */
  build(
    p: P,
    ctx: Ctx,
  ): Promise<{
    steps: Array<PlanStep<Tx>>;
    approvals: ApprovalNeed[];
    fees: FeeBreakdown;
  }>;
}
