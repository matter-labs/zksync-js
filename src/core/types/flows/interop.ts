// src/core/types/flows/interop.ts
import type { Address, Hex } from '../primitives';
import type { ApprovalNeed, Plan, Handle } from './base';
import { isHash, isHash66, isHash66Array, isAddress, isBigint, isNumber } from '../../utils';
import type { TxOverrides } from '../fees';

/**
 * The routing mechanism for interop execution.
 */
export type InteropRoute = 'direct' | 'indirect';

/**
 * An action to execute on the destination chain.
 */
export type InteropAction =
  /** Transfer native tokens (ETH) to a recipient */
  | { type: 'sendNative'; to: Address; amount: bigint }
  /** Transfer ERC-20 tokens to a recipient */
  | { type: 'sendErc20'; token: Address; to: Address; amount: bigint }
  /** Execute an arbitrary contract call */
  | { type: 'call'; to: Address; data: Hex; value?: bigint };

/**
 * Input parameters for initiating an interop operation.
 */
export interface InteropParams {
  /** Destination chain ID (EIP-155 format) */
  dstChainId: bigint;
  /** Ordered list of actions to execute on destination chain */
  actions: InteropAction[];
  /** Optional: Override default sender address for the operation */
  sender?: Address;
  /** Optional: Restrict execution to a specific address on destination */
  execution?: { only: Address };
  /** Optional: Specify who can unbundle actions */
  unbundling?: { by: Address };
  /** Optional: Gas overrides for L2 transaction */
  txOverrides?: TxOverrides;
}

/**
 * Cost and approval quote for an interop operation before execution.
 * Provides fee estimates and required token approvals.
 */
export interface InteropQuote {
  /** Routing mechanism that will be used (direct or indirect) */
  route: InteropRoute;
  /** ERC-20 approvals required before the operation can execute */
  approvalsNeeded: readonly ApprovalNeed[];
  /** Total base token value */
  totalActionValue: bigint;
  /** Total ERC-20 token amounts to be bridged */
  bridgedTokenTotal: bigint;
  /** Optional: Estimated L1 fee */
  l1Fee?: bigint;
  /** Optional: Estimated L2 fee */
  l2Fee?: bigint;
}

/**
 * Quote add-ons a route can compute
 */
export interface QuoteExtras {
  /** Sum of msg.value across actions (sendNative + call.value). */
  totalActionValue: bigint;
  /** Sum of ERC-20 amounts across actions (for approvals/bridging). */
  bridgedTokenTotal: bigint;
}

/**
 * Execution plan for an interop operation.
 * Contains transaction details, routing, and quote before submission.
 */
export type InteropPlan<Tx> = Plan<Tx, InteropRoute, InteropQuote>;

/**
 * Handle returned after initiating an interop operation.
 * Tracks the interop message through its entire lifecycle from source to destination.
 */
export interface InteropHandle<Tx>
  extends Handle<Record<string, Hex>, InteropRoute, InteropPlan<Tx>> {
  /** Discriminator for type-safe handling */
  kind: 'interop';
  /** L2 send bundle transaction hash */
  l2SrcTxHash: Hex;
  /** L2→L1 message hash */
  l1MsgHash?: Hex;
  /** Interop bundle hash */
  bundleHash?: Hex;
  /** Destination chain ID (EIP-155 format) */
  dstChainId?: bigint;
  /** Transaction hash of execution on destination chain (once executed) */
  dstExecTxHash?: Hex;
}

/**
 * Types that can be awaited to track interop operation status.
 * Either a transaction hash or a full interop handle.
 */
export type InteropWaitable = Hex | InteropHandle<unknown>;

/**
 * Lifecycle phases of an interop operation.
 * Progresses from initiation on source through execution on destination.
 */
export type InteropPhase =
  /** Bundle has been sent on source chain */
  | 'SENT'
  /** Bundle verified and ready for execution on destination chain */
  | 'VERIFIED'
  /** All actions executed on destination */
  | 'EXECUTED'
  /** Actions selectively executed or cancelled */
  | 'UNBUNDLED'
  /** Operation failed (execution reverted or invalid) */
  | 'FAILED'
  /** Status cannot be determined */
  | 'UNKNOWN';

/**
 * Interop operation status. Tracks the operation through all chains and phases.
 */
export interface InteropStatus {
  /** Current lifecycle phase of the operation */
  phase: InteropPhase;
  /** Source L2 transaction hash (initiation) */
  l2SrcTxHash?: Hex;
  /** L2→L1 message hash */
  l1MsgHash?: Hex;
  /** Interop bundle hash */
  bundleHash?: Hex;
  /** Destination chain execution transaction hash */
  dstExecTxHash?: Hex;
  /** Destination chain ID (EIP-155 format) */
  dstChainId?: bigint;
}

/**
 * Interop expected root data.
 */
export interface InteropExpectedRoot {
  /** Chain ID where the state root is published (settlement layer) */
  rootChainId: bigint;
  /** Batch number containing the interop message */
  batchNumber: bigint;
  /** Expected merkle root hash for verification */
  expectedRoot: Hex;
}

/**
 * Type guard to safely check if an object is InteropExpectedRoot.
 * Validates all required and nested fields.
 */
export function isInteropExpectedRoot(obj: unknown): obj is InteropExpectedRoot {
  if (typeof obj !== 'object' || obj === null) return false;
  const root = obj as InteropExpectedRoot;
  return isBigint(root.rootChainId) && isBigint(root.batchNumber) && isHash(root.expectedRoot);
}

/**
 * Interop message proof.
 */
export interface InteropMessageProof {
  /** Source chain ID */
  chainId: bigint;
  /** L1 batch number containing the message */
  l1BatchNumber: bigint;
  /** Index of this message within the batch */
  l2MessageIndex: bigint;
  /** The actual message content and metadata */
  message: {
    /** Transaction number within the batch */
    txNumberInBatch: number;
    /** Address that sent the message */
    sender: Address;
    /** Encoded message payload */
    data: Hex;
  };
  /** Merkle proof path for verification */
  proof: Hex[];
}

/**
 * Type guard to safely check if an object is InteropMessageProof.
 * Validates all required and nested fields.
 */
export function isInteropMessageProof(obj: unknown): obj is InteropMessageProof {
  if (typeof obj !== 'object' || obj === null) return false;
  const proof = obj as InteropMessageProof;
  return (
    isBigint(proof.chainId) &&
    isBigint(proof.l1BatchNumber) &&
    isBigint(proof.l2MessageIndex) &&
    typeof proof.message === 'object' &&
    proof.message !== null &&
    isNumber(proof.message.txNumberInBatch) &&
    isAddress(proof.message.sender) &&
    isHash(proof.message.data) &&
    isHash66Array(proof.proof)
  );
}

/**
 * Complete finalization info required to finalize an interop operation on destination.
 */
export interface InteropFinalizationInfo {
  /** Source L2 transaction hash */
  l2SrcTxHash: Hex;
  /** Interop bundle hash */
  bundleHash: Hex;
  /** Destination chain ID (EIP-155 format) */
  dstChainId: bigint;
  /** Expected state root for batch verification */
  expectedRoot: InteropExpectedRoot;
  /** Interop message proof */
  proof: InteropMessageProof;
  /** Encoded calldata for the finalization transaction */
  encodedData: Hex;
}

/**
 * Type guard to safely check if an object is InteropFinalizationInfo.
 * Validates all required and nested fields.
 */
export function isInteropFinalizationInfo(obj: unknown): obj is InteropFinalizationInfo {
  if (typeof obj !== 'object' || obj === null) return false;
  const info = obj as InteropFinalizationInfo;
  return (
    isHash66(info.l2SrcTxHash) &&
    isHash66(info.bundleHash) &&
    isBigint(info.dstChainId) &&
    isHash(info.encodedData) &&
    isInteropExpectedRoot(info.expectedRoot) &&
    isInteropMessageProof(info.proof)
  );
}

/**
 * Result of finalizing an interop operation on the destination chain.
 */
export interface InteropFinalizationResult {
  /** Interop bundle hash that was finalized */
  bundleHash: Hex;
  /** Destination chain ID */
  dstChainId: bigint;
  /** Transaction hash of the successful execution on destination */
  dstExecTxHash: Hex;
}
