import type { Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { TransactionRequest } from 'ethers';
import type { InteropRouteStrategy } from './types';
import type { InteropAttributes } from '../../../../../core/resources/interop/plan';
import {
  buildDirectBundle,
  preflightDirect,
} from '../../../../../core/resources/interop/plan';
import { formatInteropEvmAddress, formatInteropEvmChain } from '../address';

const interopCodec = {
  formatChain: formatInteropEvmChain,
  formatAddress: formatInteropEvmAddress,
};

function getInteropAttributes(params: InteropParams, ctx: BuildCtx): InteropAttributes {
  const bundleAttributes: Hex[] = [];
  if (params.execution?.only) { 
    bundleAttributes.push(ctx.attributes.bundle.executionAddress(params.execution.only));
  }
  if (params.unbundling?.by) {
    bundleAttributes.push(ctx.attributes.bundle.unbundlerAddress(params.unbundling.by));
  }

  const callAttributes = params.actions.map((action) => {
    if (action.type === 'sendNative') {
      return [ctx.attributes.call.interopCallValue(action.amount)];
    }
    if (action.type === 'call' && action.value && action.value > 0n) {
      return [ctx.attributes.call.interopCallValue(action.value)];
    }
    return [];
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
