import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy } from './types';
import { InteropCenterABI } from '../../../../../core/abi';
import {
  buildDirectBundle,
  preflightDirect,
} from '../../../../../core/resources/interop/plan';

export function routeDirect(): InteropRouteStrategy {
  return {
    async preflight(params: InteropParams, ctx: BuildCtx) {
      preflightDirect(params, {
        dstChainId: ctx.dstChainId,
        baseTokens: ctx.baseTokens,
        l2AssetRouter: ctx.l2AssetRouter,
        l2NativeTokenVault: ctx.l2NativeTokenVault,
        attributes: ctx.attributes,
      });
    },

    async build(p: InteropParams, ctx: BuildCtx) {
      const built = buildDirectBundle(p, {
        dstChainId: ctx.dstChainId,
        baseTokens: ctx.baseTokens,
        l2AssetRouter: ctx.l2AssetRouter,
        l2NativeTokenVault: ctx.l2NativeTokenVault,
        attributes: ctx.attributes,
      });

      return {
        steps: [
          {
            key: 'sendBundle',
            kind: 'interop.center',
            description: `Send interop bundle (direct route; ${p.actions.length} actions)`,
            tx: {
              address: ctx.interopCenter,
              abi: InteropCenterABI,
              functionName: 'sendBundle',
              args: [built.dstChain, built.starters, built.bundleAttrs],
              value: built.quoteExtras.totalActionValue,
              account: ctx.client.account,
            },
          },
        ],
        approvals: built.approvals,
        quoteExtras: built.quoteExtras,
      };
    },
  };
}
