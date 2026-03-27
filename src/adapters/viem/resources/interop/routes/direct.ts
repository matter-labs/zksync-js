import { encodeFunctionData } from 'viem';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy, ViemTransactionRequest } from './types';
import { buildDirectBundle, preflightDirect } from '../../../../../core/resources/interop/plan';
import { interopCodec } from '../address';
import { getInteropAttributes } from '../attributes/resource';
import { buildFeeInfo } from '../services/fee';
import { buildApproveSteps } from '../services/erc20';
import { IInteropCenterABI } from '../../../../../core/abi';

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
    async build(params: InteropParams, ctx: BuildCtx) {
      const steps: Array<{
        key: string;
        kind: string;
        description: string;
        tx: ViemTransactionRequest;
      }> = [];

      const attrs = getInteropAttributes(params, ctx);
      const feeInfo = await buildFeeInfo(params, ctx, params.actions.length);
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
        feeInfo,
      );

      steps.push(...(await buildApproveSteps(built.approvals, ctx)));

      const data = encodeFunctionData({
        abi: IInteropCenterABI,
        functionName: 'sendBundle',
        args: [built.dstChain, built.starters as never[], built.bundleAttributes],
      });

      steps.push({
        key: 'sendBundle',
        kind: 'interop.center',
        description: `Send interop bundle (direct route; ${params.actions.length} actions)`,
        tx: {
          to: ctx.interopCenter,
          data,
          value: built.quoteExtras.totalActionValue + feeInfo.fee.amount,
          ...ctx.gasOverrides,
        },
      });

      return {
        steps,
        approvals: built.approvals,
        quoteExtras: built.quoteExtras,
        interopFee: feeInfo.fee,
      };
    },
  };
}
