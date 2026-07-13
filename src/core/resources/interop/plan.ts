// src/core/resources/interop/plan.ts
import type { Address, Hex } from '../../types/primitives';
import type { ApprovalNeed } from '../../types/flows/base';
import type { InteropParams, InteropFee } from '../../types/flows/interop';
import { sumActionMsgValue, sumErc20Amounts } from './route';
import { assertNever } from '../../utils/index';

export type InteropStarter = [Hex, Hex, Hex[]];

/** Fee token and amount to include in quoteExtras. */
export interface InteropFeeInfo {
  /** Approval needed to cover the fee (ZK fixed-fee path). null = no approval needed. */
  approval: ApprovalNeed | null;
  /** Interop fee token address and total fee amount. fee.amount is added to msg.value for protocol-fee path. */
  fee: InteropFee;
}

export interface InteropBundleBuild {
  dstChain: Hex;
  starters: InteropStarter[];
  bundleAttributes: Hex[];
  approvals: ApprovalNeed[];
  interopFee: InteropFee;
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

export interface InteropAtomicSend {
  flowId: Hex;
  deadline: bigint;
  lowNullifierIndex: bigint;
}

// InteropStarter data for indirect route (encoded bridge payloads)
export interface InteropStarterData {
  assetRouterPayload?: Hex;
}

export function preflightDirect(params: InteropParams, ctx: InteropBuildCtx): void {
  void ctx;
  if (!params.actions?.length) {
    throw new Error('route "direct" requires at least one action.');
  }

  for (const action of params.actions) {
    switch (action.type) {
      case 'call':
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
  interopFeeInfo: InteropFeeInfo,
): InteropBundleBuild {
  const totalActionValue = sumActionMsgValue(params.actions);
  const starters: InteropStarter[] = params.actions.map((action, index) => {
    const to = ctx.codec.formatAddress(action.to);
    const callAttributes = attrs.callAttributes[index] ?? [];
    switch (action.type) {
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
    approvals: interopFeeInfo.approval ? [interopFeeInfo.approval] : [],
    interopFee: interopFeeInfo.fee,
    quoteExtras: {
      totalActionValue,
      bridgedTokenTotal: 0n,
    },
  };
}

export function preflightIndirect(params: InteropParams, ctx: InteropBuildCtx): void {
  void ctx;
  if (!params.actions?.length) {
    throw new Error('route "indirect" requires at least one action.');
  }

  const hasErc20 = params.actions.some((a) => a.type === 'sendErc20');
  if (!hasErc20) {
    throw new Error('route "indirect" requires at least one ERC-20 action.');
  }

  for (const action of params.actions) {
    switch (action.type) {
      case 'sendErc20':
        if (action.amount <= 0n) {
          throw new Error('sendErc20.amount must be greater than zero.');
        }
        break;
      case 'call':
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
  interopFeeInfo: InteropFeeInfo,
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
  if (interopFeeInfo.approval) approvals.push(interopFeeInfo.approval);

  const starters: InteropStarter[] = params.actions.map((action, index) => {
    const callAttributes = attrs.callAttributes[index] ?? [];

    // ERC-20 transfers go via the L2 asset router.
    if (starterData[index]?.assetRouterPayload) {
      const l2AssetRouter = ctx.codec.formatAddress(ctx.l2AssetRouter);
      return [l2AssetRouter, starterData[index].assetRouterPayload, callAttributes];
    }

    // Arbitrary zero-value calls remain direct within a mixed indirect bundle.
    const directTo = ctx.codec.formatAddress(action.to);

    switch (action.type) {
      case 'call':
        return [directTo, action.data ?? ('0x' as Hex), callAttributes];
      case 'sendErc20':
        throw new Error('buildIndirectBundle: missing assetRouterPayload for sendErc20 action.');
      default:
        return assertNever(action);
    }
  });

  return {
    dstChain: ctx.codec.formatChain(ctx.dstChainId),
    starters,
    bundleAttributes: attrs.bundleAttributes,
    approvals,
    interopFee: interopFeeInfo.fee,
    quoteExtras: {
      totalActionValue,
      bridgedTokenTotal,
    },
  };
}
