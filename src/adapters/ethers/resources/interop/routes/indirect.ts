import { Contract, type TransactionRequest } from 'ethers';
import type { Address, Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropRouteStrategy } from './types';
import type {
  InteropStarterData,
  InteropAttributes,
} from '../../../../../core/resources/interop/plan';
import { IERC20ABI, L2NativeTokenVaultABI } from '../../../../../core/abi';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';
import { buildIndirectBundle, preflightIndirect } from '../../../../../core/resources/interop/plan';
import { interopCodec } from '../address';
import { getInteropAttributes } from '../attributes/resource';
import { assertNever } from '../../../../../core/utils';

function getErc20Tokens(params: InteropParams): Address[] {
  const erc20Tokens = new Map<string, Address>();
  for (const action of params.actions) {
    if (action.type !== 'sendErc20') continue;
    erc20Tokens.set(action.token.toLowerCase(), action.token);
  }
  return Array.from(erc20Tokens.values());
}

function buildEnsureTokenSteps(
  erc20Tokens: Address[],
  ctx: BuildCtx,
): Array<{
  key: string;
  kind: string;
  description: string;
  tx: TransactionRequest;
}> {
  if (erc20Tokens.length === 0) return [];

  const ntv = new Contract(ctx.l2NativeTokenVault, L2NativeTokenVaultABI, ctx.client.l2);

  return erc20Tokens.map((token) => ({
    key: `ensure-token:${token.toLowerCase()}`,
    kind: 'interop.ntv.ensure-token',
    description: `Ensure ${token} is registered in the native token vault`,
    tx: {
      to: ctx.l2NativeTokenVault,
      data: ntv.interface.encodeFunctionData('ensureTokenIsRegistered', [token]) as Hex,
      ...ctx.gasOverrides,
    },
  }));
}

async function resolveErc20AssetIds(
  erc20Tokens: Address[],
  ctx: BuildCtx,
): Promise<Map<string, Hex>> {
  const assetIds = new Map<string, Hex>();
  if (erc20Tokens.length === 0) return assetIds;

  const ntv = new Contract(ctx.l2NativeTokenVault, L2NativeTokenVaultABI, ctx.client.getL2Signer());

  for (const token of erc20Tokens) {
    const assetId = (await ntv.getFunction('ensureTokenIsRegistered').staticCall(token)) as Hex;
    assetIds.set(token.toLowerCase(), assetId);
  }

  return assetIds;
}

async function getInteropData(
  params: InteropParams,
  ctx: BuildCtx,
  erc20AssetIds: Map<string, Hex>,
): Promise<{ attrs: InteropAttributes; starterData: InteropStarterData[] }> {
  const attributes = getInteropAttributes(params, ctx);

  const starterData: InteropStarterData[] = [];
  const callAttributes: Hex[][] = [];

  for (const action of params.actions) {
    switch (action.type) {
      case 'sendErc20': {
        const assetId = erc20AssetIds.get(action.token.toLowerCase());
        if (!assetId) {
          throw new Error(`Missing precomputed assetId for token ${action.token}.`);
        }

        const transferData = encodeNativeTokenVaultTransferData(
          action.amount,
          action.to,
          action.token,
        );
        const assetRouterPayload = encodeSecondBridgeDataV1(assetId, transferData) as Hex;
        starterData.push({ assetRouterPayload });
        break;
      }
      case 'sendNative':
        if (!ctx.baseTokens.matches) {
          const assetId = await ctx.tokens.baseTokenAssetId();
          const transferData = encodeNativeTokenVaultTransferData(
            action.amount,
            action.to,
            ctx.baseTokens.src,
          );
          const assetRouterPayload = encodeSecondBridgeDataV1(assetId, transferData) as Hex;
          starterData.push({ assetRouterPayload });
        } else {
          starterData.push({});
        }
        break;
      case 'call':
        starterData.push({});
        break;
      default:
        assertNever(action);
    }
  }

  return { attrs: attributes, starterData };
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

      const erc20Tokens = getErc20Tokens(params);
      const erc20AssetIds = await resolveErc20AssetIds(erc20Tokens, ctx);
      const { attrs, starterData } = await getInteropData(params, ctx, erc20AssetIds);
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
        starterData,
      );

      // Explicit registration steps keep quote/prepare side-effect free.
      steps.push(...buildEnsureTokenSteps(erc20Tokens, ctx));

      // Check allowance and only approve when needed.
      for (const approval of built.approvals) {
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

      return {
        steps,
        approvals: built.approvals,
        quoteExtras: built.quoteExtras,
      };
    },
  };
}
