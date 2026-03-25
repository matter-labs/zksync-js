import { encodeFunctionData } from 'viem';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy, ViemTransactionRequest } from './types';
import { buildIndirectBundle, preflightIndirect } from '../../../../../core/resources/interop/plan';
import { interopCodec } from '../address';
import {
  getErc20Tokens,
  buildEnsureTokenSteps,
  resolveErc20AssetIds,
  buildApproveSteps,
} from '../services/erc20';
import { getStarterData } from '../services/starter-data';
import { getInteropAttributes } from '../attributes/resource';
import { buildFeeInfo } from '../services/fee';
import { IInteropCenterABI } from '../../../../../core/abi';

export function routeIndirect(): InteropRouteStrategy {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async preflight(params: InteropParams, ctx: BuildCtx) {
      preflightIndirect(params, {
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

      const erc20Tokens = getErc20Tokens(params);
      const [erc20AssetIds, feeInfo] = await Promise.all([
        resolveErc20AssetIds(erc20Tokens, ctx),
        buildFeeInfo(params, ctx, params.actions.length),
      ]);
      const attributes = getInteropAttributes(params, ctx);
      const starterData = await getStarterData(params, ctx, erc20AssetIds);
      const bundle = buildIndirectBundle(
        params,
        {
          dstChainId: ctx.dstChainId,
          baseTokens: ctx.baseTokens,
          l2AssetRouter: ctx.l2AssetRouter,
          l2NativeTokenVault: ctx.l2NativeTokenVault,
          codec: interopCodec,
        },
        attributes,
        starterData,
        feeInfo,
      );

      // Explicit registration steps keep quote/prepare side-effect free.
      steps.push(...buildEnsureTokenSteps(erc20Tokens, ctx));
      steps.push(...(await buildApproveSteps(bundle.approvals, ctx)));

      const data = encodeFunctionData({
        abi: IInteropCenterABI,
        functionName: 'sendBundle',
        args: [bundle.dstChain, bundle.starters as never[], bundle.bundleAttributes],
      });

      steps.push({
        key: 'sendBundle',
        kind: 'interop.center',
        description: 'Send interop bundle (indirect route)',
        tx: {
          to: ctx.interopCenter,
          data,
          value: bundle.quoteExtras.totalActionValue + feeInfo.fee.amount,
          ...ctx.gasOverrides,
        },
      });

      return {
        steps,
        approvals: bundle.approvals,
        quoteExtras: bundle.quoteExtras,
        interopFee: feeInfo.fee,
      };
    },
  };
}
