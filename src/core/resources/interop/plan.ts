// src/core/resources/interop/plan.ts

import type { Address, Hex } from '../../types/primitives';
import type { ApprovalNeed } from '../../types/flows/base';
import type { InteropParams } from '../../types/flows/interop';
import { sumActionMsgValue, sumErc20Amounts } from './route';

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

/** ERC-7930 interoperable address encoding functions (injected by adapter) */
export interface InteropAddressCodec {
  /** Formats a chain ID as ERC-7930 interoperable address */
  formatChain(chainId: bigint): Hex;
  /** Formats an EVM address as ERC-7930 interoperable address */
  formatAddress(address: Address): Hex;
}

export interface InteropBuildCtx {
  dstChainId: bigint;
  baseTokens: { src: Address; dst: Address };
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  /** ERC-7930 address encoding (injected by adapter) */
  codec: InteropAddressCodec;
}

/** Pre-computed attributes from adapter (both bundle-level and per-call) */
export interface PrecomputedAttributes {
  bundleAttrs: Hex[];
  callAttrs: Hex[][];
}

/** Pre-computed action data for indirect route (encoded bridge payloads) */
export interface PrecomputedActionData {
  encodedPayload?: Hex;
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

export function buildDirectBundle(
  p: InteropParams,
  ctx: InteropBuildCtx,
  attrs: PrecomputedAttributes,
): InteropBundleBuild {
  const totalActionValue = sumActionMsgValue(p.actions);

  const starters: InteropStarter[] = p.actions.map((a, i) => {
    const to = ctx.codec.formatAddress(a.to);
    const callAttrs = attrs.callAttrs[i] ?? [];
    if (a.type === 'sendNative') {
      return [to, '0x' as Hex, callAttrs];
    }
    if (a.type === 'call') {
      return [to, a.data ?? ('0x' as Hex), callAttrs];
    }
    return [to, '0x' as Hex, callAttrs];
  });

  return {
    dstChain: ctx.codec.formatChain(ctx.dstChainId),
    starters,
    bundleAttrs: attrs.bundleAttrs,
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

export function buildIndirectBundle(
  p: InteropParams,
  ctx: InteropBuildCtx,
  attrs: PrecomputedAttributes,
  precomputed: PrecomputedActionData[],
): InteropBundleBuild {
  const totalActionValue = sumActionMsgValue(p.actions);
  const bridgedTokenTotal = sumErc20Amounts(p.actions);

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
  const routerInteropAddr = ctx.codec.formatAddress(ctx.l2AssetRouter);

  const starters: InteropStarter[] = p.actions.map((a, i) => {
    const callAttrs = attrs.callAttrs[i] ?? [];
    const actionData = precomputed[i];

    // Actions with pre-computed encoded payload go to the router
    if (actionData?.encodedPayload) {
      return [routerInteropAddr, actionData.encodedPayload, callAttrs];
    }

    // sendNative with matching base tokens or call/other actions go direct
    const directTo = ctx.codec.formatAddress(a.to);

    if (a.type === 'sendNative' && baseMatches) {
      return [directTo, '0x' as Hex, callAttrs];
    }

    if (a.type === 'call') {
      return [directTo, a.data ?? ('0x' as Hex), callAttrs];
    }

    return [directTo, '0x' as Hex, callAttrs];
  });

  return {
    dstChain: ctx.codec.formatChain(ctx.dstChainId),
    starters,
    bundleAttrs: attrs.bundleAttrs,
    approvals,
    quoteExtras: {
      totalActionValue,
      bridgedTokenTotal,
    },
  };
}
