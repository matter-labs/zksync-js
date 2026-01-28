import { Contract, type TransactionRequest } from 'ethers';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy } from './types';
import { IERC20ABI, L2NativeTokenVaultABI } from '../../../../../core/abi';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';
import {
  buildIndirectBundle,
  preflightIndirect,
} from '../../../../../core/resources/interop/plan';

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
      const steps: Array<{
        key: string;
        kind: string;
        description: string;
        tx: TransactionRequest;
      }> = [];

      const erc20Tokens = new Map<string, string>();
      for (const action of p.actions) {
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
          const ensureTx = await ntv.ensureTokenIsRegistered(token);
          await ensureTx.wait();
        }
      }

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

      for (const approval of built.approvals) {
        const approveData = new Contract(
          approval.token,
          IERC20ABI,
          ctx.client.l2,
        ).interface.encodeFunctionData('approve', [
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
          },
        });
      }

      const data = ctx.ifaces.interopCenter.encodeFunctionData('sendBundle', [
        built.dstChain,
        built.starters,
        built.bundleAttrs,
      ]) as Hex;

      steps.push({
        key: 'sendBundle',
        kind: 'interop.center',
        description: 'Send interop bundle (indirect route)',
        tx: {
          to: ctx.interopCenter,
          data,
          value: built.quoteExtras.totalActionValue,
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
