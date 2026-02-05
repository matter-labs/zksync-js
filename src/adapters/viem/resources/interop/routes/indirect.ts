import type { Abi, Hex } from 'viem';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep } from '../../../../../core/types/flows/base';
import type {
  InteropStarterData,
  InteropAttributes,
} from '../../../../../core/resources/interop/plan';
import { IERC20ABI, InteropCenterABI, L2NativeTokenVaultABI } from '../../../../../core/abi';
import { FORMAL_ETH_ADDRESS } from '../../../../../core/constants';
import { buildIndirectBundle, preflightIndirect } from '../../../../../core/resources/interop/plan';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';
import { formatInteropEvmAddress, formatInteropEvmChain } from '../address';

const interopCodec = {
  formatChain: formatInteropEvmChain,
  formatAddress: formatInteropEvmAddress,
};

async function getInteropData(
  params: InteropParams,
  ctx: BuildCtx,
): Promise<{ attrs: InteropAttributes; precomputed: InteropStarterData[] }> {
  const baseMatches = ctx.baseTokens.src.toLowerCase() === ctx.baseTokens.dst.toLowerCase();

  // Pre-compute bundle attributes
  const bundleAttributes: Hex[] = [];
  if (params.execution?.only) {
    bundleAttributes.push(ctx.attributes.bundle.executionAddress(params.execution.only));
  }
  if (params.unbundling?.by) {
    bundleAttributes.push(ctx.attributes.bundle.unbundlerAddress(params.unbundling.by));
  }

  // Pre-compute per-action data and call attributes
  const precomputed: InteropStarterData[] = [];
  const callAttributes: Hex[][] = [];

  for (const action of params.actions) {
    if (action.type === 'sendErc20') {
      const assetId = await ctx.tokens.assetIdOfL2(action.token);
      const transferData = encodeNativeTokenVaultTransferData(
        action.amount,
        action.to,
        FORMAL_ETH_ADDRESS,
      );
      const assetRouterPayload = encodeSecondBridgeDataV1(assetId, transferData);
      precomputed.push({ assetRouterPayload });
      callAttributes.push([ctx.attributes.call.indirectCall(0n)]);
    } else if (action.type === 'sendNative' && !baseMatches) {
      const assetId = await ctx.tokens.baseTokenAssetId();
      const transferData = encodeNativeTokenVaultTransferData(
        action.amount,
        action.to,
        FORMAL_ETH_ADDRESS,
      );
      const assetRouterPayload = encodeSecondBridgeDataV1(assetId, transferData);
      precomputed.push({ assetRouterPayload });
      callAttributes.push([ctx.attributes.call.indirectCall(action.amount)]);
    } else if (action.type === 'sendNative') {
      precomputed.push({});
      callAttributes.push([ctx.attributes.call.interopCallValue(action.amount)]);
    } else if (action.type === 'call') {
      precomputed.push({});
      callAttributes.push(
        action.value && action.value > 0n
          ? [ctx.attributes.call.interopCallValue(action.value)]
          : [],
      );
    } else {
      precomputed.push({});
      callAttributes.push([]);
    }
  }

  return { attrs: { bundleAttributes, callAttributes }, precomputed };
}

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
      const steps: Array<PlanStep<ViemPlanWriteRequest>> = [];

      const erc20Tokens = new Map<string, string>();
      for (const action of params.actions) {
        if (action.type !== 'sendErc20') continue;
        erc20Tokens.set(action.token.toLowerCase(), action.token);
      }

      if (erc20Tokens.size > 0) {
        const wallet = await ctx.client.walletFor();
        for (const token of erc20Tokens.values()) {
          const hash = await wallet.writeContract({
            address: ctx.l2NativeTokenVault,
            abi: L2NativeTokenVaultABI,
            functionName: 'ensureTokenIsRegistered',
            args: [token as Hex],
            account: ctx.client.account,
            chain: null,
          });
          await ctx.client.l2.waitForTransactionReceipt({ hash });
        }
      }

      // Pre-compute all data in adapter before calling core
      const { attrs, precomputed } = await getInteropData(params, ctx);

      const built = buildIndirectBundle(
        params,
        {
          dstChainId: ctx.dstChainId,
          baseTokens: ctx.baseTokens,
          l2AssetRouter: ctx.l2AssetRouter,
          l2NativeTokenVault: ctx.l2NativeTokenVault,
          codec: interopCodec,
        },
        attrs,
        precomputed,
      );

      // Check allowance and only approve what's needed
      for (const approval of built.approvals) {
        const currentAllowance = (await ctx.client.l2.readContract({
          address: approval.token,
          abi: IERC20ABI as Abi,
          functionName: 'allowance',
          args: [ctx.sender, ctx.l2NativeTokenVault],
        })) as bigint;

        if (currentAllowance < approval.amount) {
          const approveAmount = approval.amount - currentAllowance;
          steps.push({
            key: `approve:${approval.token}:${ctx.l2NativeTokenVault}`,
            kind: 'approve',
            description: `Approve ${ctx.l2NativeTokenVault} to spend ${approveAmount} of ${approval.token}`,
            tx: {
              address: approval.token,
              abi: IERC20ABI,
              functionName: 'approve',
              args: [ctx.l2NativeTokenVault, approveAmount],
              account: ctx.client.account,
              ...(ctx.gasOverrides && {
                gas: ctx.gasOverrides.gasLimit,
                maxFeePerGas: ctx.gasOverrides.maxFeePerGas,
                maxPriorityFeePerGas: ctx.gasOverrides.maxPriorityFeePerGas,
              }),
            },
          });
        }
      }

      steps.push({
        key: 'sendBundle',
        kind: 'interop.center',
        description: 'Send interop bundle (indirect route)',
        tx: {
          address: ctx.interopCenter,
          abi: InteropCenterABI,
          functionName: 'sendBundle',
          args: [built.dstChain, built.starters, built.bundleAttributes],
          value: built.quoteExtras.totalActionValue,
          account: ctx.client.account,
          ...(ctx.gasOverrides && {
            gas: ctx.gasOverrides.gasLimit,
            maxFeePerGas: ctx.gasOverrides.maxFeePerGas,
            maxPriorityFeePerGas: ctx.gasOverrides.maxPriorityFeePerGas,
          }),
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
