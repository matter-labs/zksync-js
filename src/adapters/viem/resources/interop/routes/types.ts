import type { WalletClient, Transport, Chain, Account } from 'viem';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';

type WriteParams = Parameters<WalletClient<Transport, Chain, Account>['writeContract']>[0];

export type ViemPlanWriteRequest = Omit<WriteParams, 'value'> & { value?: bigint };

export interface QuoteExtras {
  totalActionValue: bigint;
  bridgedTokenTotal: bigint;
}

export interface InteropRouteStrategy {
  preflight?(p: InteropParams, ctx: BuildCtx): Promise<void> | void;

  build(
    p: InteropParams,
    ctx: BuildCtx,
  ): Promise<{
    steps: Array<PlanStep<ViemPlanWriteRequest>>;
    approvals: ApprovalNeed[];
    quoteExtras: QuoteExtras;
  }>;
}
