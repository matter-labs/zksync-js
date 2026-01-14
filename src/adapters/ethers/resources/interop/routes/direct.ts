import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { InteropFeeBreakdown } from '../../../../../core/types/fees';
import type { RouteStrategy } from '../../../../../core/types/flows/route';
import type { BuildCtx } from '../context';
import type { TransactionRequest } from 'ethers';
import type { InteropRouteStrategy } from './types';

export function routeDirect(): InteropRouteStrategy {
  return {
    preflight(p: InteropParams, ctx: BuildCtx) {
      // TODO: validations
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async build(p: InteropParams, ctx: BuildCtx) {
      // Build direct interop transaction request
    },
  };
}
