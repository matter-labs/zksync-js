import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { TransactionRequest } from 'ethers';
import type { InteropRouteStrategy } from './types';
import type { InteropAttributes } from '../../../../../core/resources/interop/plan';
import { buildDirectBundle, preflightDirect } from '../../../../../core/resources/interop/plan';
import { interopCodec } from '../address';
import { extractBundleAttributes } from '../attributes/resource';
import { assertNever } from '../../../../../core/utils';

function getInteropAttributes(params: InteropParams, ctx: BuildCtx): InteropAttributes {
  const bundleAttributes = extractBundleAttributes(params, ctx);

  const callAttributes = params.actions.map((action) => {
    switch (action.type) {
      case 'sendNative':
        return [ctx.attributes.call.interopCallValue(action.amount)];
      case 'call':
        if (action.value && action.value > 0n) {
          return [ctx.attributes.call.interopCallValue(action.value)];
        }
        return [];
      case 'sendErc20':
        throw new Error(
          `route "direct" does not support sendErc20 actions; use the indirect route.`,
        );
      default:
        assertNever(action);
    }
  });

  return { bundleAttributes, callAttributes };
}

export function routeDirect(): InteropRouteStrategy {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async preflight(params: InteropParams, ctx: BuildCtx) {
      preflightDirect(params, {
        dstChainId: ctx.dstChainId,
        baseTokens: ctx.baseTokens,
        l2AssetRouter: ctx.l2AssetRouter,
        l2NativeTokenVault: ctx.l2NativeTokenVault,
        codec: interopCodec,
      });
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async build(params: InteropParams, ctx: BuildCtx) {
      const steps: Array<{
        key: string;
        kind: string;
        description: string;
        tx: TransactionRequest;
      }> = [];

      const attrs = getInteropAttributes(params, ctx);
      const built = buildDirectBundle(
        params,
        {
          dstChainId: ctx.dstChainId,
          baseTokens: ctx.baseTokens,
          l2AssetRouter: ctx.l2AssetRouter,
          l2NativeTokenVault: ctx.l2NativeTokenVault,
          codec: interopCodec,
        },
        attrs,
      );

      const data = ctx.ifaces.interopCenter.encodeFunctionData('sendBundle', [
        built.dstChain,
        built.starters,
        built.bundleAttributes,
      ]);

      steps.push({
        key: 'sendBundle',
        kind: 'interop.center',
        description: `Send interop bundle (direct route; ${params.actions.length} actions)`,
        // In direct route, msg.value equals the total forwarded value across
        // all calls (sendNative.amount + call.value).
        tx: {
          to: ctx.interopCenter,
          data,
          value: built.quoteExtras.totalActionValue,
          ...ctx.gasOverrides,
        },
      });

      return {
        steps,
        approvals: built.approvals,
        quoteExtras: built.quoteExtras,
      };
    },
  };
}
