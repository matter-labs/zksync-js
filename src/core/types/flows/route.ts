// src/types/flows/route.ts

import type { ApprovalNeed, PlanStep } from './base';

// Generic strategy contract for any flow
export interface RouteStrategy<P, Tx, QuoteExtras = unknown, Ctx = unknown> {
  /** Optional preflight to refine route / sanity checks. */
  preflight?(p: P, ctx: Ctx): Promise<void>;

  /** Build plan (tx steps + approvals). */
  build(
    p: P,
    ctx: Ctx,
  ): Promise<{
    steps: Array<PlanStep<Tx>>;
    approvals: ApprovalNeed[];
    /** Optional per-route add-ons used by the resource to compose the Quote. */
    quoteExtras: QuoteExtras;
  }>;
}
