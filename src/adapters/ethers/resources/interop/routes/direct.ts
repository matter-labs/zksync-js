import type { Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { TransactionRequest } from 'ethers';
import type { InteropRouteStrategy } from './types';
import type { PrecomputedAttributes } from '../../../../../core/resources/interop/plan';
import {
  buildDirectBundle,
  preflightDirect,
} from '../../../../../core/resources/interop/plan';
import { formatInteropEvmAddress, formatInteropEvmChain } from '../address';

const interopCodec = {
  formatChain: formatInteropEvmChain,
  formatAddress: formatInteropEvmAddress,
};

function precomputeDirectAttrs(p: InteropParams, ctx: BuildCtx): PrecomputedAttributes {
  const bundleAttrs: Hex[] = [];
  if (p.execution?.only) {
    bundleAttrs.push(ctx.attributes.bundle.executionAddress(p.execution.only));
  }
  if (p.unbundling?.by) {
    bundleAttrs.push(ctx.attributes.bundle.unbundlerAddress(p.unbundling.by));
  }

  const callAttrs = p.actions.map((a) => {
    if (a.type === 'sendNative') {
      return [ctx.attributes.call.interopCallValue(a.amount)];
    }
    if (a.type === 'call' && a.value && a.value > 0n) {
      return [ctx.attributes.call.interopCallValue(a.value)];
    }
    return [];
  });

  return { bundleAttrs, callAttrs };
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
    async build(p: InteropParams, ctx: BuildCtx) {
      const steps: Array<{
        key: string;
        kind: string;
        description: string;
        tx: TransactionRequest;
      }> = [];

      const attrs = precomputeDirectAttrs(p, ctx);
      const built = buildDirectBundle(
        p,
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
        built.bundleAttrs,
      ]);

      steps.push({
        key: 'sendBundle',
        kind: 'interop.center',
        description: `Send interop bundle (direct route; ${p.actions.length} actions)`,
        // In direct route, msg.value equals the total forwarded value across
        // all calls (sendNative.amount + call.value).
        tx: {
          to: ctx.interopCenter,
          data,
          value: built.quoteExtras.totalActionValue,
        },
      });

      //
      // Return route plan
      //
      return {
        steps,
        approvals: built.approvals,
        quoteExtras: built.quoteExtras,
      };
    },
  };
}
