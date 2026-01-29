import type { Hex } from 'viem';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep } from '../../../../../core/types/flows/base';
import type {
  PrecomputedActionData,
  PrecomputedAttributes,
} from '../../../../../core/resources/interop/plan';
import { IERC20ABI, InteropCenterABI, L2NativeTokenVaultABI } from '../../../../../core/abi';
import { FORMAL_ETH_ADDRESS } from '../../../../../core/constants';
import {
  buildIndirectBundle,
  preflightIndirect,
} from '../../../../../core/resources/interop/plan';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';
import { formatInteropEvmAddress, formatInteropEvmChain } from '../address';

const interopCodec = {
  formatChain: formatInteropEvmChain,
  formatAddress: formatInteropEvmAddress,
};

async function precomputeIndirectData(
  p: InteropParams,
  ctx: BuildCtx,
): Promise<{ attrs: PrecomputedAttributes; precomputed: PrecomputedActionData[] }> {
  const baseMatches = ctx.baseTokens.src.toLowerCase() === ctx.baseTokens.dst.toLowerCase();

  // Pre-compute bundle attributes
  const bundleAttrs: Hex[] = [];
  if (p.execution?.only) {
    bundleAttrs.push(ctx.attributes.bundle.executionAddress(p.execution.only));
  }
  if (p.unbundling?.by) {
    bundleAttrs.push(ctx.attributes.bundle.unbundlerAddress(p.unbundling.by));
  }

  // Pre-compute per-action data and call attributes
  const precomputed: PrecomputedActionData[] = [];
  const callAttrs: Hex[][] = [];

  for (const a of p.actions) {
    if (a.type === 'sendErc20') {
      const assetId = await ctx.tokens.assetIdOfL2(a.token);
      const transferData = encodeNativeTokenVaultTransferData(a.amount, a.to, FORMAL_ETH_ADDRESS);
      const encodedPayload = encodeSecondBridgeDataV1(assetId, transferData);
      precomputed.push({ encodedPayload });
      callAttrs.push([ctx.attributes.call.indirectCall(0n)]);
    } else if (a.type === 'sendNative' && !baseMatches) {
      const assetId = await ctx.tokens.baseTokenAssetId();
      const transferData = encodeNativeTokenVaultTransferData(a.amount, a.to, FORMAL_ETH_ADDRESS);
      const encodedPayload = encodeSecondBridgeDataV1(assetId, transferData);
      precomputed.push({ encodedPayload });
      callAttrs.push([ctx.attributes.call.indirectCall(a.amount)]);
    } else if (a.type === 'sendNative') {
      precomputed.push({});
      callAttrs.push([ctx.attributes.call.interopCallValue(a.amount)]);
    } else if (a.type === 'call') {
      precomputed.push({});
      callAttrs.push(a.value && a.value > 0n ? [ctx.attributes.call.interopCallValue(a.value)] : []);
    } else {
      precomputed.push({});
      callAttrs.push([]);
    }
  }

  return { attrs: { bundleAttrs, callAttrs }, precomputed };
}

export function routeIndirect(): InteropRouteStrategy {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async preflight(p: InteropParams, ctx: BuildCtx) {
      preflightIndirect(p, {
        dstChainId: ctx.dstChainId,
        baseTokens: ctx.baseTokens,
        l2AssetRouter: ctx.l2AssetRouter,
        l2NativeTokenVault: ctx.l2NativeTokenVault,
        codec: interopCodec,
      });
    },

    async build(p: InteropParams, ctx: BuildCtx) {
      const steps: Array<PlanStep<ViemPlanWriteRequest>> = [];

      const erc20Tokens = new Map<string, string>();
      for (const action of p.actions) {
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
      const { attrs, precomputed } = await precomputeIndirectData(p, ctx);

      const built = buildIndirectBundle(
        p,
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

      steps.push(
        ...built.approvals.map((approval) => ({
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
        })),
      );

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
