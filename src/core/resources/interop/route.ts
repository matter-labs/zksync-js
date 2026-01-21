// src/core/interop/route.ts
import type { Address } from '../../types/primitives';
import type { InteropAction, InteropRoute } from '../../types/flows/interop';

export interface InteropCtx {
  sender: Address;
  srcChainId: bigint;
  dstChainId: bigint;
  /** canonical base token addresses for src/dst */
  baseTokenSrc: Address;
  baseTokenDst: Address;
}

/** Sums action-level native value (sendNative + call.value) */
export function sumActionMsgValue(actions: readonly InteropAction[]): bigint {
  let v = 0n;
  for (const a of actions) {
    if (a.type === 'sendNative') v += a.amount;
    else if (a.type === 'call' && a.value) v += a.value;
  }
  return v;
}

/** Sums ERC-20 amounts (for bridge planning & approvals) */
export function sumErc20Amounts(actions: readonly InteropAction[]): bigint {
  let v = 0n;
  for (const a of actions) if (a.type === 'sendErc20') v += a.amount;
  return v;
}

/** Picks the high-level route. Keep simple & deterministic. */
export function pickInteropRoute(args: {
  actions: readonly InteropAction[];
  ctx: InteropCtx;
}): InteropRoute {
  const hasErc20 = args.actions.some((a) => a.type === 'sendErc20');
  const baseMatches = args.ctx.baseTokenSrc.toLowerCase() === args.ctx.baseTokenDst.toLowerCase();

  // ERC-20 present → indirect. Base mismatch for value → indirect. Else direct.
  if (hasErc20) return 'indirect';
  if (!baseMatches) return 'indirect';
  return 'direct';
}
