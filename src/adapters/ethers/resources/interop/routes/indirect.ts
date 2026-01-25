import { Contract, type TransactionRequest } from 'ethers';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { Hex } from '../../../../../core/types/primitives';
import type { ApprovalNeed } from '../../../../../core/types/flows/base';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy } from './types';
import { sumActionMsgValue, sumErc20Amounts } from '../../../../../core/resources/interop/route';
import { formatInteropEvmAddress, formatInteropEvmChain } from '../../../../../core/resources/interop/address';
import { IERC20ABI } from '../../../../../core/abi';
import { FORMAL_ETH_ADDRESS } from '../../../../../core/constants';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';

export function routeIndirect(): InteropRouteStrategy {
  return {
    async preflight(p: InteropParams, ctx: BuildCtx) {
      if (!p.actions?.length) {
        throw new Error('route "indirect" requires at least one action.');
      }

      const hasErc20 = p.actions.some((a) => a.type === 'sendErc20');
      const baseMatches = ctx.baseTokens.src.toLowerCase() === ctx.baseTokens.dst.toLowerCase();

      if (!hasErc20 && baseMatches) {
        throw new Error(
          'route "indirect" requires ERC-20 actions or mismatched base tokens; use the direct route instead.',
        );
      }

      for (const a of p.actions) {
        if (a.type === 'sendNative' && a.amount < 0n) {
          throw new Error('sendNative.amount must be >= 0.');
        }
        if (a.type === 'sendErc20' && a.amount < 0n) {
          throw new Error('sendErc20.amount must be >= 0.');
        }
        if (a.type === 'call' && a.value != null) {
          if (a.value < 0n) {
            throw new Error('call.value must be >= 0 when provided.');
          }
          if (a.value > 0n && !baseMatches) {
            throw new Error(
              'indirect route does not support call.value when base tokens differ.',
            );
          }
        }

      }
    },
    async build(p: InteropParams, ctx: BuildCtx) {
      const steps: Array<{
        key: string;
        kind: string;
        description: string;
        tx: TransactionRequest;
      }> = [];

      //
      // 1. Totals for quote context
      //
      const totalActionValue = sumActionMsgValue(p.actions);
      const bridgedTokenTotal = sumErc20Amounts(p.actions);

      //
      // 2. ERC-20 approvals (source chain)
      // Approve NativeTokenVault to pull ERC-20s before burn/escrow.
      //
      const approvals: ApprovalNeed[] = [];
      const { l2NativeTokenVault } = await ctx.contracts.addresses();

      for (const a of p.actions) {
        if (a.type !== 'sendErc20') continue;

        approvals.push({
          token: a.token,
          spender: l2NativeTokenVault,
          amount: a.amount,
        });

        const approveData = new Contract(
          a.token,
          IERC20ABI,
          ctx.client.l2,
        ).interface.encodeFunctionData('approve', [l2NativeTokenVault, a.amount]) as Hex;

        steps.push({
          key: `approve:${a.token}:${l2NativeTokenVault}`,
          kind: 'approve',
          description: `Approve ${l2NativeTokenVault} to spend ${a.amount} of ${a.token}`,
          tx: {
            to: a.token,
            data: approveData,
          },
        });
      }

      //
      // 3. Bundle-level attributes
      //
      const bundleAttrs: Hex[] = [];
      if (p.execution?.only) {
        bundleAttrs.push(ctx.attributes.bundle.executionAddress(p.execution.only));
      }
      if (p.unbundling?.by) {
        bundleAttrs.push(ctx.attributes.bundle.unbundlerAddress(p.unbundling.by));
      }

      //
      // 4. Per-call attributes + starters
      //
      const baseMatches = ctx.baseTokens.src.toLowerCase() === ctx.baseTokens.dst.toLowerCase();
      const routerInteropAddr = formatInteropEvmAddress(ctx.l2AssetRouter);

      const starters: Array<[Hex, Hex, Hex[]]> = await Promise.all(
        p.actions.map(async (a) => {
          //
          // Case 1: ERC-20 bridge
          //
          if (a.type === 'sendErc20') {
            const assetId = await ctx.tokens.assetIdOfL2(a.token);
            const transferData = encodeNativeTokenVaultTransferData(
              a.amount,
              a.to,
              FORMAL_ETH_ADDRESS,
            ) as Hex;
            const payload = encodeSecondBridgeDataV1(assetId, transferData) as Hex;

            return [routerInteropAddr, payload, [ctx.attributes.call.indirectCall(0n)]];
          }

          //
          // Case 2: Native bridge because base tokens differ
          //
          if (a.type === 'sendNative' && !baseMatches) {
            const assetId = await ctx.tokens.baseTokenAssetId();
            const transferData = encodeNativeTokenVaultTransferData(
              a.amount,
              a.to,
              FORMAL_ETH_ADDRESS,
            ) as Hex;
            const payload = encodeSecondBridgeDataV1(assetId, transferData) as Hex;

            return [routerInteropAddr, payload, [ctx.attributes.call.indirectCall(a.amount)]];
          }

          //
          // Case 3: Direct call in a mixed bundle
          //
          const directTo = formatInteropEvmAddress(a.to);

          if (a.type === 'sendNative') {
            return [directTo, '0x' as Hex, [ctx.attributes.call.interopCallValue(a.amount)]];
          }

          if (a.type === 'call') {
            const callAttrs: Hex[] =
              a.value && a.value > 0n ? [ctx.attributes.call.interopCallValue(a.value)] : [];
            return [directTo, a.data ?? '0x', callAttrs];
          }

          return [directTo, '0x' as Hex, []];
        }),
      );

      //
      // 5. Encode InteropCenter.sendBundle(...)
      //
      const dstChain = formatInteropEvmChain(ctx.dstChainId);
      const data = ctx.ifaces.interopCenter.encodeFunctionData('sendBundle', [
        dstChain,
        starters,
        bundleAttrs,
      ]) as Hex;

      steps.push({
        key: 'sendBundle',
        kind: 'interop.center',
        description: 'Send interop bundle (indirect route)',
        tx: {
          to: ctx.interopCenter,
          data,
          value: totalActionValue,
        },
      });

      //
      // 6. Return route plan
      //
      return {
        steps,
        approvals,
        quoteExtras: {
          totalActionValue,
          bridgedTokenTotal,
        },
      };
    },
  };
}
