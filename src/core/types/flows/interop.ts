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

/** === Waitable === */
export type InteropWaitable =
  | Hex
  | InteropHandle<unknown>;

/** === Status & phases === */
export type InteropPhase =
  | 'SENT' // InteropBundleSent observed on source
  | 'VERIFIED' // bundle verified on destination
  | 'EXECUTED' // fully executed atomically
  | 'UNBUNDLED' // selectively executed/cancelled
  | 'FAILED'
  | 'UNKNOWN';

export interface InteropStatus {
  phase: InteropPhase;
  l2SrcTxHash?: Hex;
  l1MsgHash?: Hex;
  bundleHash?: Hex;
  dstExecTxHash?: Hex;
  dstChainId?: bigint;
}

export interface InteropExpectedRoot {
  rootChainId: bigint;
  batchNumber: bigint;
  expectedRoot: Hex;
}

export interface InteropMessageProof {
  chainId: bigint;
  l1BatchNumber: bigint;
  l2MessageIndex: bigint;
  message: {
    txNumberInBatch: number;
    sender: Address;
    data: Hex;
  };
  proof: Hex[];
}

export interface InteropFinalizationInfo {
  l2SrcTxHash: Hex;
  bundleHash: Hex;
  dstChainId: bigint;
  expectedRoot: InteropExpectedRoot;
  proof: InteropMessageProof;
  encodedData: Hex;
}

export function isInteropFinalizationInfo(obj: unknown): obj is InteropFinalizationInfo {
  if (typeof obj !== 'object' || obj === null) return false;
  const info = obj as InteropFinalizationInfo;
  return (
    typeof info.l2SrcTxHash === 'string' &&
    typeof info.bundleHash === 'string' &&
    typeof info.dstChainId === 'bigint' &&
    typeof info.encodedData === 'string' &&
    typeof info.expectedRoot === 'object' &&
    info.expectedRoot !== null &&
    typeof info.expectedRoot.rootChainId === 'bigint' &&
    typeof info.expectedRoot.batchNumber === 'bigint' &&
    typeof info.expectedRoot.expectedRoot === 'string' &&
    typeof info.proof === 'object' &&
    info.proof !== null &&
    typeof info.proof.chainId === 'bigint' &&
    typeof info.proof.l1BatchNumber === 'bigint' &&
    typeof info.proof.l2MessageIndex === 'bigint' &&
    typeof info.proof.message === 'object' &&
    info.proof.message !== null &&
    typeof info.proof.message.txNumberInBatch === 'number' &&
    typeof info.proof.message.sender === 'string'
  );
};

export interface InteropFinalizationResult {
  bundleHash: Hex;
  dstChainId: bigint;
  dstExecTxHash: Hex;
}
