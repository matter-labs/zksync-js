import { Contract, type TransactionRequest } from 'ethers';
import type { Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy } from './types';
import type {
  InteropStarterData,
  InteropAttributes,
} from '../../../../../core/resources/interop/plan';
import { IERC20ABI, L2NativeTokenVaultABI } from '../../../../../core/abi';
import { FORMAL_ETH_ADDRESS } from '../../../../../core/constants';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';
import { buildIndirectBundle, preflightIndirect } from '../../../../../core/resources/interop/plan';
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
      const assetRouterPayload = encodeSecondBridgeDataV1(assetId, transferData) as Hex;
      precomputed.push({ assetRouterPayload });
      callAttributes.push([ctx.attributes.call.indirectCall(0n)]);
    } else if (action.type === 'sendNative' && !baseMatches) {
      const assetId = await ctx.tokens.baseTokenAssetId();
      const transferData = encodeNativeTokenVaultTransferData(
        action.amount,
        action.to,
        FORMAL_ETH_ADDRESS,
      );
      const assetRouterPayload = encodeSecondBridgeDataV1(assetId, transferData) as Hex;
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
      const steps: Array<{
        key: string;
        kind: string;
        description: string;
        tx: TransactionRequest;
      }> = [];

      const erc20Tokens = new Map<string, string>();
      for (const action of params.actions) {
        if (action.type !== 'sendErc20') continue;
        erc20Tokens.set(action.token.toLowerCase(), action.token);
      }

      if (erc20Tokens.size > 0) {
        const ntv = new Contract(
          ctx.l2NativeTokenVault,
          L2NativeTokenVaultABI,
          ctx.client.getL2Signer(),
        );

        for (const token of erc20Tokens.values()) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const ensureTx = await ntv.ensureTokenIsRegistered(token);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          await ensureTx.wait();
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
        const erc20 = new Contract(approval.token, IERC20ABI, ctx.client.l2);
        const currentAllowance = (await erc20.allowance(
          ctx.sender,
          ctx.l2NativeTokenVault,
        )) as bigint;

        if (currentAllowance < approval.amount) {
          const approveAmount = approval.amount - currentAllowance;
          const approveData = erc20.interface.encodeFunctionData('approve', [
            ctx.l2NativeTokenVault,
            approveAmount,
          ]) as Hex;

          steps.push({
            key: `approve:${approval.token}:${ctx.l2NativeTokenVault}`,
            kind: 'approve',
            description: `Approve ${ctx.l2NativeTokenVault} to spend ${approveAmount} of ${approval.token}`,
            tx: {
              to: approval.token,
              data: approveData,
              ...ctx.gasOverrides,
            },
          });
        }
      }

      const data = ctx.ifaces.interopCenter.encodeFunctionData('sendBundle', [
        built.dstChain,
        built.starters,
        built.bundleAttributes,
      ]) as Hex;

      steps.push({
        key: 'sendBundle',
        kind: 'interop.center',
        description: 'Send interop bundle (indirect route)',
        tx: {
          to: ctx.interopCenter,
          data,
          value: built.quoteExtras.totalActionValue,
          ...ctx.gasOverrides,
        },
      });

      //
      // 6. Return route plan
      //
      return {
        steps,
        approvals: built.approvals,
        quoteExtras: built.quoteExtras,
      };
    },
  };
}
