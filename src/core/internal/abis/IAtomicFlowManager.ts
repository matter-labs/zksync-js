// IAtomicFlowManager (era-contracts `l1-contracts/contracts/atomic-interop/IAtomicFlowManager.sol`).
// Deployed on every ZKsync OS chain at `L2_ATOMIC_FLOW_MANAGER_ADDRESS`. Its custom errors are in
// `IAtomicInteropErrors`.
import {
  ATOMIC_FINALITY_PROOF_COMPONENTS,
  ATOMIC_FLOW_COMPONENTS,
  ATOMIC_FLOW_PREIMAGE_COMPONENTS,
  IMT_PROOF_COMPONENTS,
} from './AtomicInteropTypes';

const IAtomicFlowManagerABI = [
  {
    type: 'function',
    name: 'append',
    inputs: [
      { name: '_bundleHash', type: 'bytes32', internalType: 'bytes32' },
      { name: '_lowNullifierIndex', type: 'uint256', internalType: 'uint256' },
      {
        name: '_flowPreimage',
        type: 'tuple',
        internalType: 'struct AtomicFlowPreimage',
        components: ATOMIC_FLOW_PREIMAGE_COMPONENTS,
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'authorizeRefund',
    inputs: [
      {
        name: '_flow',
        type: 'tuple',
        internalType: 'struct AtomicFlow',
        components: ATOMIC_FLOW_COMPONENTS,
      },
      { name: '_missingLegIndex', type: 'uint256', internalType: 'uint256' },
      {
        name: '_absence',
        type: 'tuple',
        internalType: 'struct ImtProof',
        components: IMT_PROOF_COMPONENTS,
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimRefund',
    inputs: [
      { name: '_flowId', type: 'bytes32', internalType: 'bytes32' },
      { name: '_bundle', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'commitmentTree',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'initL2',
    inputs: [{ name: '_l1ChainId', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'interopCenter',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'interopHandler',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'legState',
    inputs: [
      { name: '_flowId', type: 'bytes32', internalType: 'bytes32' },
      { name: '_bundleHash', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'uint8', internalType: 'enum LegState' }],
    stateMutability: 'view',
  },
  {
    // `onlyInteropHandler`: to ask "is this flow executable?", simulate it with `from` set to
    // `L2_INTEROP_HANDLER_ADDRESS`.
    type: 'function',
    name: 'requireFlowFinalized',
    inputs: [
      { name: '_executingBundleHash', type: 'bytes32', internalType: 'bytes32' },
      {
        name: '_finality',
        type: 'tuple',
        internalType: 'struct AtomicFinalityProof',
        components: ATOMIC_FINALITY_PROOF_COMPONENTS,
      },
    ],
    outputs: [],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'FlowCommitted',
    inputs: [
      { name: 'flowId', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'bundleHash', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'deadline', type: 'uint64', indexed: false, internalType: 'uint64' },
      { name: 'leafIndex', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FlowRefundAuthorized',
    inputs: [
      { name: 'flowId', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'bundleHash', type: 'bytes32', indexed: true, internalType: 'bytes32' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FlowRefunded',
    inputs: [
      { name: 'flowId', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'bundleHash', type: 'bytes32', indexed: true, internalType: 'bytes32' },
    ],
    anonymous: false,
  },
] as const;

export default IAtomicFlowManagerABI;
