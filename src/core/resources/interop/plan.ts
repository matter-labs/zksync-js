// src/core/resources/interop/plan.ts
import type { Address, Hex } from '../../types/primitives';
import type { ApprovalNeed } from '../../types/flows/base';
import type { InteropParams } from '../../types/flows/interop';
import { sumActionMsgValue, sumErc20Amounts } from './route';
import { assertNever } from '../../utils/index';

export type InteropStarter = [Hex, Hex, Hex[]];

export interface InteropBundleBuild {
  dstChain: Hex;
  starters: InteropStarter[];
  bundleAttributes: Hex[];
  approvals: ApprovalNeed[];
  quoteExtras: {
    totalActionValue: bigint;
    bridgedTokenTotal: bigint;
  };
}

// ERC-7930 interoperable address encoding functions (injected by adapter)
export interface InteropAddressCodec {
  // Formats a chain ID as ERC-7930 interoperable address
  formatChain(chainId: bigint): Hex;
  // Formats an EVM address as ERC-7930 interoperable address
  formatAddress(address: Address): Hex;
}

export interface InteropBuildCtx {
  dstChainId: bigint;
  baseTokens: { src: Address; dst: Address };
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  // ERC-7930 address encoding (injected by adapter)
  codec: InteropAddressCodec;
}

// Interop attributes from adapter (both bundle-level and per-call)
export interface InteropAttributes {
  bundleAttributes: Hex[];
  callAttributes: Hex[][];
}

// InteropStarter data for indirect route (encoded bridge payloads)
export interface InteropStarterData {
  assetRouterPayload?: Hex;
}

export function preflightDirect(params: InteropParams, ctx: InteropBuildCtx): void {
  if (!params.actions?.length) {
    throw new Error('route "direct" requires at least one action.');
  }

  const baseMatch = ctx.baseTokens.src.toLowerCase() === ctx.baseTokens.dst.toLowerCase();
  if (!baseMatch) {
    throw new Error('route "direct" requires matching base tokens between source and destination.');
  }

  for (const action of params.actions) {
    switch (action.type) {
      case 'sendNative':
        if (action.amount < 0n) {
          throw new Error('sendNative.amount must be >= 0.');
        }
        break;
      case 'call':
        if (action.value != null && action.value < 0n) {
          throw new Error('call.value must be >= 0 when provided.');
        }
        break;
      default:
        throw new Error(
          `route "direct" does not support ${action.type} actions; use the indirect route.`,
        );
    }
  }
}

export function buildDirectBundle(
  params: InteropParams,
  ctx: InteropBuildCtx,
  attrs: InteropAttributes,
): InteropBundleBuild {
  const totalActionValue = sumActionMsgValue(params.actions);
  const starters: InteropStarter[] = params.actions.map((action, index) => {
    const to = ctx.codec.formatAddress(action.to);
    const callAttributes = attrs.callAttributes[index] ?? [];
    switch (action.type) {
      case 'sendNative':
        return [to, '0x' as Hex, callAttributes];
      case 'call':
        return [to, action.data ?? ('0x' as Hex), callAttributes];
      default:
        throw new Error(`buildDirectBundle: unsupported action type "${action.type}".`);
    }
  });

  return {
    dstChain: ctx.codec.formatChain(ctx.dstChainId),
    starters,
    bundleAttributes: attrs.bundleAttributes,
    approvals: [],
    quoteExtras: {
      totalActionValue,
      bridgedTokenTotal: 0n,
    },
  };
}

export function preflightIndirect(params: InteropParams, ctx: InteropBuildCtx): void {
  if (!params.actions?.length) {
    throw new Error('route "indirect" requires at least one action.');
  }

  const hasErc20 = params.actions.some((a) => a.type === 'sendErc20');
  const baseMatches = ctx.baseTokens.src.toLowerCase() === ctx.baseTokens.dst.toLowerCase();

  if (!hasErc20 && baseMatches) {
    throw new Error(
      'route "indirect" requires ERC-20 actions or mismatched base tokens; use the direct route instead.',
    );
  }

  for (const action of params.actions) {
    switch (action.type) {
      case 'sendNative':
        if (action.amount < 0n) {
          throw new Error('sendNative.amount must be >= 0.');
        }
        break;
      case 'sendErc20':
        if (action.amount < 0n) {
          throw new Error('sendErc20.amount must be >= 0.');
        }
        break;
      case 'call':
        if (action.value != null) {
          if (action.value < 0n) {
            throw new Error('call.value must be >= 0 when provided.');
          }
          if (action.value > 0n && !baseMatches) {
            throw new Error('indirect route does not support call.value when base tokens differ.');
          }
        }
        break;
      default:
        assertNever(action);
    }
  }
}

export function buildIndirectBundle(
  params: InteropParams,
  ctx: InteropBuildCtx,
  attrs: InteropAttributes,
  starterData: InteropStarterData[],
): InteropBundleBuild {
  const totalActionValue = sumActionMsgValue(params.actions);
  const bridgedTokenTotal = sumErc20Amounts(params.actions);

  // Aggregate approvals for the same token
  const approvalMap = new Map<string, ApprovalNeed>();
  for (const action of params.actions) {
    if (action.type !== 'sendErc20') continue;
    const key = action.token.toLowerCase();
    const existing = approvalMap.get(key);
    if (existing) {
      existing.amount += action.amount;
    } else {
      approvalMap.set(key, {
        token: action.token,
        spender: ctx.l2NativeTokenVault,
        amount: action.amount,
      });
    }
  }
  const approvals = Array.from(approvalMap.values());

  const starters: InteropStarter[] = params.actions.map((action, index) => {
    const callAttributes = attrs.callAttributes[index] ?? [];

    // sendErc20 and sendNative with different base tokens go via L2 asset router
    if (starterData[index]?.assetRouterPayload) {
      const l2AssetRouter = ctx.codec.formatAddress(ctx.l2AssetRouter);
      return [l2AssetRouter, starterData[index].assetRouterPayload, callAttributes];
    }

    // sendNative with matching base tokens or call/other actions go direct
    const directTo = ctx.codec.formatAddress(action.to);

    switch (action.type) {
      case 'sendNative':
        return [directTo, '0x' as Hex, callAttributes];
      case 'call':
        return [directTo, action.data ?? ('0x' as Hex), callAttributes];
      default:
        return [directTo, '0x' as Hex, callAttributes];
    }
  });

  return {
    dstChain: ctx.codec.formatChain(ctx.dstChainId),
    starters,
    bundleAttributes: attrs.bundleAttributes,
    approvals,
    quoteExtras: {
      totalActionValue,
      bridgedTokenTotal,
    },
  };
}
