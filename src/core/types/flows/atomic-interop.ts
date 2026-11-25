// src/core/types/flows/atomic-interop.ts
//
// Atomic interop: the legs of one flow are interop bundles sent on (possibly different) source
// chains. Each leg commits to the flow's id on its source chain; then either every leg is proven
// committed in time and each destination executes its leg, or one leg is proven absent by the
// deadline and every committed leg is refunded.
//
// The shapes below mirror era-contracts `IAtomicInterop.sol` and `Messaging.sol` field for field,
// so adapters can ABI-encode them directly.

import type { Address, Hex } from '../primitives';

/** One leg of an atomic flow: a bundle's hash and the chain that sends it. */
export interface AtomicLeg {
  /** `keccak256` of the leg's ABI-encoded `InteropBundle`. */
  bundleHash: Hex;
  /** The chain the leg is sent from. */
  sourceChainId: bigint;
}

/**
 * The hashed definition of a flow: `flowId = keccak256(abi.encode(preimage))`. Legs are in
 * strictly ascending order of their bundle hash, with each source chain alongside its hash.
 */
export interface AtomicFlowPreimage {
  /** Preimage format version; see `ATOMIC_FLOW_PREIMAGE_VERSION`. */
  version: Hex;
  /** The settlement-layer timestamp by which every leg must be in a settled batch. */
  deadline: bigint;
  /** The single settlement layer every leg must settle on. */
  settlementLayerChainId: bigint;
  legBundleHashes: Hex[];
  legSourceChainIds: bigint[];
}

/** A flow as the finalize and refund paths take it: the id and the preimage it is hashed from. */
export interface AtomicFlow {
  flowId: Hex;
  preimage: AtomicFlowPreimage;
}

/** One leaf of an Indexed Merkle Tree, in on-chain field order. */
export interface ImtLeaf {
  value: bigint;
  nextIndex: bigint;
  nextValue: bigint;
}

/**
 * A proof against a source chain's interop commitment tree, as the contracts take it (`ImtProof`
 * in `IAtomicInterop.sol`). It proves inclusion (the leaf holds the commit value) or, for the
 * refund path, absence (the leaf is the low-nullifier leaf bracketing the absent value).
 */
export interface ImtProof {
  sourceChainId: bigint;
  batchNumber: bigint;
  chainImtRoot: Hex;
  /** `true` proves against the batch-begin root (absence), `false` the batch-end root (inclusion). */
  provesAgainstBeginRoot: boolean;
  /** Multi-hop settlement proof; see `readSettlementLayerReference`. */
  settlementProof: Hex[];
  leaf: ImtLeaf;
  imtLeafIndex: bigint;
  imtProof: Hex[];
}

/**
 * An IMT proof as `zks_getImtInclusionProof` / `zks_getImtNonInclusionProof` return it: the
 * on-chain `ImtProof` without `sourceChainId` (the node only proves its own chain), plus the
 * settlement-layer block whose interop root the proof ends at.
 */
export interface ImtProofResponse {
  batchNumber: bigint;
  /**
   * The settlement-layer block whose root the proof anchors to (`interopRoots[slChainId][block]`).
   * The verifying chain must have imported that root before the proof is submitted.
   */
  settlementBlockNumber: bigint;
  provesAgainstBeginRoot: boolean;
  chainImtRoot: Hex;
  settlementProof: Hex[];
  leaf: ImtLeaf;
  imtLeafIndex: bigint;
  imtProof: Hex[];
}

/** What `executeAtomicBundle` needs: the flow, and one inclusion proof per leg in leg order. */
export interface AtomicFinalityProof {
  flow: AtomicFlow;
  proofs: ImtProof[];
}

/** A leg's state on its source chain; see `ATOMIC_LEG_STATE`. */
export type AtomicLegState = 0 | 1 | 2 | 3;

/**
 * Where a multi-hop settlement proof ends on the settlement layer, as
 * `MessageHashing.readSettlementLayerReference` reads it. These words are only as trustworthy as
 * the proof: the contracts authenticate them when they verify it.
 */
export interface SettlementLayerReference {
  /** The settlement-layer block (or batch) whose interop root the proof ends at. */
  settlementLayerBatchNumber: bigint;
  settlementLayerChainId: bigint;
  /** When the settlement layer included the proven batch; compared with a flow's deadline. */
  l1BatchTimestamp: bigint;
}

/** One call of an `InteropBundle` (`InteropCall` in `Messaging.sol`). */
export interface InteropBundleCall {
  version: Hex;
  /** Reserved, always `false`. */
  shadowAccount: boolean;
  to: Address;
  from: Address;
  value: bigint;
  data: Hex;
}

/** `BundleAttributes` in `Messaging.sol` (protocol v32+, which added `salt`). */
export interface InteropBundleAttributes {
  /** ERC-7930 address that alone may execute the bundle, or `0x` for permissionless execution. */
  executionAddress: Hex;
  /** ERC-7930 address that may unbundle the bundle. */
  unbundlerAddress: Hex;
  useFixedFee: boolean;
  /** The sender-chosen salt, as passed in the `interopBundleSalt` attribute. */
  salt: Hex;
}

/**
 * An `InteropBundle` (protocol v32+). Its ABI encoding is the `bundleData` that
 * `executeAtomicBundle` and `claimRefund` take, and its `keccak256` is the bundle hash.
 */
export interface InteropBundle {
  version: Hex;
  sourceChainId: bigint;
  destinationChainId: bigint;
  destinationBaseTokenAssetId: Hex;
  /** `keccak256(abi.encodePacked(sender, salt))`; see `computeInteropBundleSalt`. */
  interopBundleSalt: Hex;
  calls: InteropBundleCall[];
  bundleAttributes: InteropBundleAttributes;
}
