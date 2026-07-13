// src/core/interop/route.ts
import type { Address } from '../../types/primitives';
import type { InteropAction, InteropRoute } from '../../types/flows/interop';

export interface InteropCtx {
  sender: Address;
  srcChainId: bigint;
  dstChainId: bigint;
  // canonical base token addresses for src/dst
  baseTokenSrc: Address;
  baseTokenDst: Address;
}

// Native-value legs remain disabled until timeout recovery is production-ready.
export function sumActionMsgValue(_actions: readonly InteropAction[]): bigint {
  void _actions;
  return 0n;
}

// Sums ERC-20 amounts (for bridge planning & approvals)
export function sumErc20Amounts(actions: readonly InteropAction[]): bigint {
  let sum = 0n;
  for (const a of actions) if (a.type === 'sendErc20') sum += a.amount;
  return sum;
}

// Picks the high-level route.
export function pickInteropRoute(args: {
  actions: readonly InteropAction[];
  ctx: InteropCtx;
}): InteropRoute {
  const hasErc20 = args.actions.some((a) => a.type === 'sendErc20');
  // ERC-20 burns require the asset-router path. Recoverable zero-value calls are direct.
  if (hasErc20) return 'indirect';
  return 'direct';
}
