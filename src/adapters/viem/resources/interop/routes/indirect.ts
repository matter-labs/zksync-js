import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep } from '../../../../../core/types/flows/base';
import { IERC20ABI, InteropCenterABI } from '../../../../../core/abi';
import {
  buildIndirectBundle,
  preflightIndirect,
} from '../../../../../core/resources/interop/plan';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';

export function routeIndirect(): InteropRouteStrategy {
  return {
    async preflight(p: InteropParams, ctx: BuildCtx) {
      preflightIndirect(p, {
        dstChainId: ctx.dstChainId,
        baseTokens: ctx.baseTokens,
        l2AssetRouter: ctx.l2AssetRouter,
        l2NativeTokenVault: ctx.l2NativeTokenVault,
        attributes: ctx.attributes,
      });
    },

    async build(p: InteropParams, ctx: BuildCtx) {
      const built = await buildIndirectBundle(
        p,
        {
          dstChainId: ctx.dstChainId,
          baseTokens: ctx.baseTokens,
          l2AssetRouter: ctx.l2AssetRouter,
          l2NativeTokenVault: ctx.l2NativeTokenVault,
          attributes: ctx.attributes,
        },
        ctx.tokens,
        {
          encodeNativeTokenVaultTransferData,
          encodeSecondBridgeDataV1,
        },
      );

      const steps: Array<PlanStep<ViemPlanWriteRequest>> = built.approvals.map((approval) => ({
        key: `approve:${approval.token}:${ctx.l2NativeTokenVault}`,
        kind: 'approve',
        description: `Approve ${ctx.l2NativeTokenVault} to spend ${approval.amount} of ${approval.token}`,
        tx: {
          address: approval.token,
          abi: IERC20ABI,
          functionName: 'approve',
          args: [ctx.l2NativeTokenVault, approval.amount],
          account: ctx.client.account,
        },
      }));

      steps.push({
        key: 'sendBundle',
        kind: 'interop.center',
        description: 'Send interop bundle (indirect route)',
        tx: {
          address: ctx.interopCenter,
          abi: InteropCenterABI,
          functionName: 'sendBundle',
          args: [built.dstChain, built.starters, built.bundleAttrs],
          value: built.quoteExtras.totalActionValue,
          account: ctx.client.account,
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
