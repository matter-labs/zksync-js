import { Contract, type TransactionRequest } from 'ethers';
import type { Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy } from './types';
import { IERC20ABI } from '../../../../../core/abi';
import { buildIndirectBundle, preflightIndirect } from '../../../../../core/resources/interop/plan';
import { interopCodec } from '../address';
import { getErc20Tokens, buildEnsureTokenSteps, resolveErc20AssetIds } from '../services/erc20';
import { getStarterData } from '../services/starter-data';
import { getInteropAttributes } from '../attributes/resource';

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
        tx: TransactionRequest;
      }> = [];

      const erc20Tokens = getErc20Tokens(params);
      const erc20AssetIds = await resolveErc20AssetIds(erc20Tokens, ctx);
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
      );

      // Explicit registration steps keep quote/prepare side-effect free.
      steps.push(...buildEnsureTokenSteps(erc20Tokens, ctx));

      // Check allowance and only approve when needed.
      for (const approval of bundle.approvals) {
        const erc20 = new Contract(approval.token, IERC20ABI, ctx.client.l2);
        const currentAllowance = (await erc20.allowance(
          ctx.sender,
          ctx.l2NativeTokenVault,
        )) as bigint;

        if (currentAllowance < approval.amount) {
          const approveData = erc20.interface.encodeFunctionData('approve', [
            ctx.l2NativeTokenVault,
            approval.amount,
          ]) as Hex;

          steps.push({
            key: `approve:${approval.token}:${ctx.l2NativeTokenVault}`,
            kind: 'approve',
            description: `Approve ${ctx.l2NativeTokenVault} to spend ${approval.amount} of ${approval.token}`,
            tx: {
              to: approval.token,
              data: approveData,
              ...ctx.gasOverrides,
            },
          });
        }
      }

      const data = ctx.ifaces.interopCenter.encodeFunctionData('sendBundle', [
        bundle.dstChain,
        bundle.starters,
        bundle.bundleAttributes,
      ]) as Hex;

      steps.push({
        key: 'sendBundle',
        kind: 'interop.center',
        description: 'Send interop bundle (indirect route)',
        tx: {
          to: ctx.interopCenter,
          data,
          value: bundle.quoteExtras.totalActionValue,
          ...ctx.gasOverrides,
        },
      });

      return {
        steps,
        approvals: bundle.approvals,
        quoteExtras: bundle.quoteExtras,
      };
    },
  };
}
