// ABI parameter fragments of the atomic-interop structs, shared by the ABIs that take them.
// Source of truth: era-contracts `l1-contracts/contracts/atomic-interop/IAtomicInterop.sol` and
// `l1-contracts/contracts/common/Messaging.sol` (protocol v32+ `InteropBundle`).
//
// The nesting must match the contracts exactly: a mismatch ABI-decodes to garbage on-chain and
// reverts without revert data.

export const ATOMIC_FLOW_PREIMAGE_COMPONENTS = [
  { name: 'version', type: 'bytes1', internalType: 'bytes1' },
  { name: 'deadline', type: 'uint64', internalType: 'uint64' },
  { name: 'settlementLayerChainId', type: 'uint256', internalType: 'uint256' },
  { name: 'legBundleHashes', type: 'bytes32[]', internalType: 'bytes32[]' },
  { name: 'legSourceChainIds', type: 'uint256[]', internalType: 'uint256[]' },
] as const;

/** `AtomicFlowPreimage`: `flowId = keccak256(abi.encode(preimage))`. */
export const ATOMIC_FLOW_PREIMAGE_PARAM = {
  name: 'preimage',
  type: 'tuple',
  internalType: 'struct AtomicFlowPreimage',
  components: ATOMIC_FLOW_PREIMAGE_COMPONENTS,
} as const;

export const ATOMIC_FLOW_COMPONENTS = [
  { name: 'flowId', type: 'bytes32', internalType: 'bytes32' },
  ATOMIC_FLOW_PREIMAGE_PARAM,
] as const;

export const IMT_LEAF_COMPONENTS = [
  { name: 'value', type: 'uint256', internalType: 'uint256' },
  { name: 'nextIndex', type: 'uint256', internalType: 'uint256' },
  { name: 'nextValue', type: 'uint256', internalType: 'uint256' },
] as const;

export const IMT_PROOF_COMPONENTS = [
  { name: 'sourceChainId', type: 'uint256', internalType: 'uint256' },
  { name: 'batchNumber', type: 'uint256', internalType: 'uint256' },
  { name: 'chainImtRoot', type: 'bytes32', internalType: 'bytes32' },
  { name: 'provesAgainstBeginRoot', type: 'bool', internalType: 'bool' },
  { name: 'settlementProof', type: 'bytes32[]', internalType: 'bytes32[]' },
  { name: 'leaf', type: 'tuple', internalType: 'struct IMTLeaf', components: IMT_LEAF_COMPONENTS },
  { name: 'imtLeafIndex', type: 'uint256', internalType: 'uint256' },
  { name: 'imtProof', type: 'bytes32[]', internalType: 'bytes32[]' },
] as const;

/** `ImtProof`, as the finalize and refund paths take it. */
export const IMT_PROOF_PARAM = {
  name: 'proof',
  type: 'tuple',
  internalType: 'struct ImtProof',
  components: IMT_PROOF_COMPONENTS,
} as const;

export const ATOMIC_FINALITY_PROOF_COMPONENTS = [
  {
    name: 'flow',
    type: 'tuple',
    internalType: 'struct AtomicFlow',
    components: ATOMIC_FLOW_COMPONENTS,
  },
  {
    name: 'proofs',
    type: 'tuple[]',
    internalType: 'struct ImtProof[]',
    components: IMT_PROOF_COMPONENTS,
  },
] as const;

export const INTEROP_BUNDLE_COMPONENTS = [
  { name: 'version', type: 'bytes1', internalType: 'bytes1' },
  { name: 'sourceChainId', type: 'uint256', internalType: 'uint256' },
  { name: 'destinationChainId', type: 'uint256', internalType: 'uint256' },
  { name: 'destinationBaseTokenAssetId', type: 'bytes32', internalType: 'bytes32' },
  { name: 'interopBundleSalt', type: 'bytes32', internalType: 'bytes32' },
  {
    name: 'calls',
    type: 'tuple[]',
    internalType: 'struct InteropCall[]',
    components: [
      { name: 'version', type: 'bytes1', internalType: 'bytes1' },
      { name: 'shadowAccount', type: 'bool', internalType: 'bool' },
      { name: 'to', type: 'address', internalType: 'address' },
      { name: 'from', type: 'address', internalType: 'address' },
      { name: 'value', type: 'uint256', internalType: 'uint256' },
      { name: 'data', type: 'bytes', internalType: 'bytes' },
    ],
  },
  {
    name: 'bundleAttributes',
    type: 'tuple',
    internalType: 'struct BundleAttributes',
    components: [
      { name: 'executionAddress', type: 'bytes', internalType: 'bytes' },
      { name: 'unbundlerAddress', type: 'bytes', internalType: 'bytes' },
      { name: 'useFixedFee', type: 'bool', internalType: 'bool' },
      { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
] as const;

/**
 * `InteropBundle` (protocol v32+, whose `BundleAttributes` carries `salt`). `abi.encode(bundle)` is
 * the `bundleData` that `executeAtomicBundle` and `claimRefund` take.
 */
export const INTEROP_BUNDLE_PARAM = {
  name: 'interopBundle',
  type: 'tuple',
  internalType: 'struct InteropBundle',
  components: INTEROP_BUNDLE_COMPONENTS,
} as const;
