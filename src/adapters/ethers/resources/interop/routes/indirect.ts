import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { InteropFeeBreakdown } from '../../../../../core/types/fees';
import type { RouteStrategy } from '../../../../../core/types/flows/route';
import type { BuildCtx } from '../context';
import type { TransactionRequest } from 'ethers';
import type { InteropRouteStrategy } from './types';
import { ApprovalNeed, PlanStep } from '../../../../../core';

export function routeIndirect(): InteropRouteStrategy {
  return {
    async preflight(p: InteropParams, ctx: BuildCtx) {
      // TODO: validations
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async build(p: InteropParams, ctx: BuildCtx) {
      return null as any as {
        steps: PlanStep<TransactionRequest, undefined>[];
        approvals: ApprovalNeed[];
        quoteExtras: {
          totalActionValue: bigint;
          bridgedTokenTotal: bigint;
        },
        //fees: InteropFeeBreakdown;
      };
      // Build indirect interop transaction request
    },
  };
}
