import type { ApprovalNeed, Handle, Plan } from './base';
import type { TxOverrides } from '../fees';
import type { Address, Hex } from '../primitives';

export type InteropRoute = 'direct' | 'indirect';

export interface AtomicRecoverable {
  protocol: 'IAtomicRecoverable';
}

export type InteropAction =
  | { type: 'sendErc20'; token: Address; to: Address; amount: bigint }
  | { type: 'call'; to: Address; data: Hex; recovery: AtomicRecoverable };

/** Parameters for one independently owned source leg. */
export interface InteropParams {
  actions: InteropAction[];
  /** Absolute timestamp on the common settlement layer. */
  deadline: bigint;
  /** Defaults to the SDK's configured L1 chain. */
  settlementLayerChainId?: bigint;
  execution?: { only: Address };
  fee?: { useFixed: boolean };
  txOverrides?: TxOverrides;
}

export interface InteropFee {
  token: Address;
  amount: bigint;
}

export interface InteropQuote {
  route: InteropRoute;
  approvalsNeeded: readonly ApprovalNeed[];
  totalActionValue: bigint;
  bridgedTokenTotal: bigint;
  interopFee: InteropFee;
  deadline: bigint;
  settlementLayerChainId: bigint;
  bundleHash?: Hex;
  flowId?: Hex;
  l2Fee?: bigint;
}

export interface QuoteExtras {
  totalActionValue: bigint;
  bridgedTokenTotal: bigint;
}

export type AtomicInteropCallStarter = readonly [
  to: Hex,
  data: Hex,
  callAttributes: readonly Hex[],
];

/** Exact hash-preview payload. The out-of-band atomic attribute is added after flow agreement. */
export interface AtomicInteropBundlePayload {
  destinationChain: Hex;
  starters: readonly AtomicInteropCallStarter[];
  bundleAttributes: readonly Hex[];
  value: bigint;
}

export interface AtomicInteropCommitment {
  bundleHash: Hex;
  sourceChainId: bigint;
  settlementLayerChainId?: bigint;
}

export interface AtomicInteropLegDraft extends AtomicInteropCommitment {
  kind: 'atomic-interop-leg';
  version: 1;
  sender: Address;
  destinationChainId: bigint;
  settlementLayerChainId: bigint;
  deadline: bigint;
  salt: Hex;
  route: InteropRoute;
  params: InteropParams;
  payload: AtomicInteropBundlePayload;
  commitment: AtomicInteropCommitment;
}

export interface AtomicInteropFlow {
  kind: 'atomic-interop-flow';
  version: 1;
  flowId: Hex;
  deadline: bigint;
  settlementLayerChainId: bigint;
  legBundleHashes: readonly Hex[];
  legSourceChainIds: readonly bigint[];
}

export interface AtomicInteropFlowParams {
  legs: readonly AtomicInteropCommitment[];
  deadline: bigint;
  settlementLayerChainId?: bigint;
}

export interface AtomicInteropDeadlineParams {
  afterSeconds: number | bigint;
}

export interface AtomicInteropIntent {
  kind: 'atomic-interop-intent';
  version: 1;
  draft: AtomicInteropLegDraft;
  flow: AtomicInteropFlow;
}

export type InteropInput = InteropParams | AtomicInteropIntent;

export interface InteropPlan<Tx> extends Plan<Tx, InteropRoute, InteropQuote> {
  intent: AtomicInteropIntent;
  payload: AtomicInteropBundlePayload;
  bundleHash: Hex;
  flowId: Hex;
  lowNullifierIndex: bigint;
}

export interface InteropHandle<Tx>
  extends Handle<Record<string, Hex>, InteropRoute, InteropPlan<Tx>> {
  kind: 'interop';
  intent: AtomicInteropIntent;
  l2SrcTxHash: Hex;
  bundleHash: Hex;
  /** `abi.encode(InteropBundle)` from the emitted InteropBundleSent event. */
  encodedBundle: Hex;
}

export type AtomicInteropLegState = 'UNSET' | 'COMMITTED' | 'REVERTABLE' | 'REVERTED';

export type AtomicInteropBundleState = 'UNRECEIVED' | 'VERIFIED' | 'FULLY_EXECUTED' | 'UNBUNDLED';

export type InteropPhase =
  | 'UNSET'
  | 'COMMITTED'
  | 'VERIFIED'
  | 'EXECUTED'
  | 'UNBUNDLED'
  | 'REFUNDABLE'
  | 'REFUNDED'
  | 'INCONSISTENT'
  | 'UNKNOWN';

export interface InteropStatus {
  phase: InteropPhase;
  flowId: Hex;
  bundleHash: Hex;
  sourceChainId: bigint;
  destinationChainId: bigint;
  source: {
    state: AtomicInteropLegState | 'UNKNOWN';
    txHash?: Hex;
  };
  destination: {
    state: AtomicInteropBundleState | 'UNKNOWN';
  };
}

export interface AtomicInteropIndexRequest {
  sourceChainId: bigint;
  flowId: Hex;
  bundleHash: Hex;
  commitValue: bigint;
}

export type AtomicInteropIndexProvider = (
  request: AtomicInteropIndexRequest,
) => Promise<bigint | null | undefined>;

export interface InteropApprovalResult {
  approvals: readonly ApprovalNeed[];
  stepHashes: Record<string, Hex>;
}
