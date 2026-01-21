// src/core/types/flows/interop.ts
import type { Address, Hex } from '../primitives';
import type { ApprovalNeed, Plan, Handle } from './base';

export type EncodedCallAttributes = readonly Hex[];
export type EncodedBundleAttributes = readonly Hex[];

export interface DecodedAttribute {
  selector: Hex; // 0x + 8 hex chars (4-byte selector)
  name: string;
  signature?: string; // e.g. "interopCallValue(uint256)" when ABI is known
  args: unknown[];
}

export interface DecodedAttributesSummary {
  call: DecodedAttribute[];
  bundle: DecodedAttribute[];
}

export type InteropRoute = 'direct' | 'indirect';

export type InteropAction =
  | { type: 'sendNative'; to: Address; amount: bigint }
  | { type: 'sendErc20'; token: Address; to: Address; amount: bigint }
  | { type: 'call'; to: Address; data: Hex; value?: bigint };

export interface InteropParams {
  dst: bigint;
  actions: InteropAction[];
  sender?: Address;
  execution?: { only: Address };
  unbundling?: { by: Address };
}

export interface InteropQuote {
  route: InteropRoute;
  approvalsNeeded: readonly ApprovalNeed[];

  /** Value semantics */
  totalActionValue: bigint; // sum of msg.value across actions (sendNative + call.value)
  bridgedTokenTotal: bigint; // sum of ERC-20 amounts to bridge (normalized total)
  // Fees (keep generic; adapters can refine/override)
  l1Fee?: bigint;
  l2Fee?: bigint;
}

export type InteropPlan<Tx> = Plan<Tx, InteropRoute, InteropQuote>;

/** === Handle (returned by create) === */
export interface InteropHandle<Tx>
  extends Handle<Record<string, Hex>, InteropRoute, InteropPlan<Tx>> {
  kind: 'interop';
  /** Source L2 tx that emitted InteropBundleSent */
  l2SrcTxHash: Hex;
  /** L2->L1 message hash (from the messenger) if surfaced by the adapter */
  l1MsgHash?: Hex;
  /** Bundle hash (destination-unique id) if surfaced by the adapter */
  bundleHash?: Hex;
  /** Destination chain id (eip155) */
  dstChainId?: bigint;
  /** Destination execution tx hash (if/once known) */
  dstExecTxHash?: Hex;
}