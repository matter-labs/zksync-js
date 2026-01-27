// src/core/resources/interop/plan.ts

import type { Address, Hex } from '../../types/primitives';
import type { ApprovalNeed } from '../../types/flows/base';
import type { InteropParams } from '../../types/flows/interop';
import type { TokensResource } from '../../types/flows/token';
import type { AttributesResource } from './attributes/resource';
import { formatInteropEvmAddress, formatInteropEvmChain } from './address';
import { sumActionMsgValue, sumErc20Amounts } from './route';
import { FORMAL_ETH_ADDRESS } from '../../constants';

export type InteropStarter = [Hex, Hex, Hex[]];

export interface InteropBundleBuild {
  dstChain: Hex;
  starters: InteropStarter[];
  bundleAttrs: Hex[];
  approvals: ApprovalNeed[];
  quoteExtras: {
    totalActionValue: bigint;
    bridgedTokenTotal: bigint;
  };
}

export interface InteropBuildCtx {
  dstChainId: bigint;
  baseTokens: { src: Address; dst: Address };
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  attributes: AttributesResource;
}

export interface BridgeCodec {
  encodeNativeTokenVaultTransferData(amount: bigint, receiver: Address, token: Address): Hex;
  encodeSecondBridgeDataV1(assetId: Hex, transferData: Hex): Hex;
}

function buildBundleAttrs(p: InteropParams, attributes: AttributesResource): Hex[] {
  const bundleAttrs: Hex[] = [];
  if (p.execution?.only) {
    bundleAttrs.push(attributes.bundle.executionAddress(p.execution.only));
  }
  if (p.unbundling?.by) {
    bundleAttrs.push(attributes.bundle.unbundlerAddress(p.unbundling.by));
  }
  return bundleAttrs;
}

export function preflightDirect(p: InteropParams, ctx: InteropBuildCtx): void {
  if (!p.actions?.length) {
    throw new Error('route "direct" requires at least one action.');
  }

  const hasErc20 = p.actions.some((a) => a.type === 'sendErc20');
  if (hasErc20) {
    throw new Error('route "direct" does not support ERC-20 actions; use the router route.');
  }

  const baseMatch = ctx.baseTokens.src.toLowerCase() === ctx.baseTokens.dst.toLowerCase();
  if (!baseMatch) {
    throw new Error('route "direct" requires matching base tokens between source and destination.');
  }

  for (const a of p.actions) {
    if (a.type === 'sendNative' && a.amount < 0n) {
      throw new Error('sendNative.amount must be >= 0.');
    }
    if (a.type === 'call' && a.value != null && a.value < 0n) {
      throw new Error('call.value must be >= 0 when provided.');
    }
  }
}

export function buildDirectBundle(p: InteropParams, ctx: InteropBuildCtx): InteropBundleBuild {
  const totalActionValue = sumActionMsgValue(p.actions);

  const bundleAttrs = buildBundleAttrs(p, ctx.attributes);

  const perCallAttrs: Hex[][] = p.actions.map((a) => {
    if (a.type === 'sendNative') {
      return [ctx.attributes.call.interopCallValue(a.amount)];
    }
    if (a.type === 'call' && a.value && a.value > 0n) {
      return [ctx.attributes.call.interopCallValue(a.value)];
    }
    return [];
  });

  const starters: InteropStarter[] = p.actions.map((a, i) => {
    const to = formatInteropEvmAddress(a.to);
    if (a.type === 'sendNative') {
      return [to, '0x' as Hex, perCallAttrs[i] ?? []];
    }
    if (a.type === 'call') {
      return [to, a.data ?? ('0x' as Hex), perCallAttrs[i] ?? []];
    }
    return [to, '0x' as Hex, perCallAttrs[i] ?? []];
  });

  return {
    dstChain: formatInteropEvmChain(ctx.dstChainId),
    starters,
    bundleAttrs,
    approvals: [],
    quoteExtras: {
      totalActionValue,
      bridgedTokenTotal: 0n,
    },
  };
}

export function preflightIndirect(p: InteropParams, ctx: InteropBuildCtx): void {
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
        throw new Error('indirect route does not support call.value when base tokens differ.');
      }
    }
  }
}

export async function buildIndirectBundle(
  p: InteropParams,
  ctx: InteropBuildCtx,
  tokens: TokensResource,
  codec: BridgeCodec,
): Promise<InteropBundleBuild> {
  const totalActionValue = sumActionMsgValue(p.actions);
  const bridgedTokenTotal = sumErc20Amounts(p.actions);
  const bundleAttrs = buildBundleAttrs(p, ctx.attributes);

  const approvals: ApprovalNeed[] = [];
  for (const a of p.actions) {
    if (a.type !== 'sendErc20') continue;
    approvals.push({
      token: a.token,
      spender: ctx.l2NativeTokenVault,
      amount: a.amount,
    });
  }

  const baseMatches = ctx.baseTokens.src.toLowerCase() === ctx.baseTokens.dst.toLowerCase();
  const routerInteropAddr = formatInteropEvmAddress(ctx.l2AssetRouter);

  const starters: InteropStarter[] = await Promise.all(
    p.actions.map(async (a) => {
      if (a.type === 'sendErc20') {
        const assetId = await tokens.assetIdOfL2(a.token);
        const transferData = codec.encodeNativeTokenVaultTransferData(
          a.amount,
          a.to,
          FORMAL_ETH_ADDRESS,
        );
        const payload = codec.encodeSecondBridgeDataV1(assetId, transferData);
        return [routerInteropAddr, payload, [ctx.attributes.call.indirectCall(0n)]];
      }

      if (a.type === 'sendNative' && !baseMatches) {
        const assetId = await tokens.baseTokenAssetId();
        const transferData = codec.encodeNativeTokenVaultTransferData(
          a.amount,
          a.to,
          FORMAL_ETH_ADDRESS,
        );
        const payload = codec.encodeSecondBridgeDataV1(assetId, transferData);
        return [routerInteropAddr, payload, [ctx.attributes.call.indirectCall(a.amount)]];
      }

      const directTo = formatInteropEvmAddress(a.to);

      if (a.type === 'sendNative') {
        return [directTo, '0x' as Hex, [ctx.attributes.call.interopCallValue(a.amount)]];
      }

      if (a.type === 'call') {
        const callAttrs: Hex[] =
          a.value && a.value > 0n ? [ctx.attributes.call.interopCallValue(a.value)] : [];
        return [directTo, a.data ?? ('0x' as Hex), callAttrs];
      }

      return [directTo, '0x' as Hex, []];
    }),
  );

  return {
    dstChain: formatInteropEvmChain(ctx.dstChainId),
    starters,
    bundleAttrs,
    approvals,
    quoteExtras: {
      totalActionValue,
      bridgedTokenTotal,
    },
  };
}
