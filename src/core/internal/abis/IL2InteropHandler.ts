// IL2InteropHandler (era-contracts `l1-contracts/contracts/interop/interop-handler/IL2InteropHandler.sol`
// and `IInteropHandlerBase.sol`): the atomic-interop entry points of the L2 interop handler, which
// lives at `L2_INTEROP_HANDLER_ADDRESS`. On chains where L2 -> L2 interop is atomic, a destination
// executes a bundle only through `executeAtomicBundle`.
import { ATOMIC_FINALITY_PROOF_COMPONENTS } from './AtomicInteropTypes';

const IL2InteropHandlerABI = [
  {
    type: 'function',
    name: 'bundleStatus',
    inputs: [{ name: 'bundleHash', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [{ name: '', type: 'uint8', internalType: 'enum BundleStatus' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'callStatus',
    inputs: [
      { name: 'bundleHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'callIndex', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint8', internalType: 'enum CallStatus' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'executeAtomicBundle',
    inputs: [
      { name: '_bundle', type: 'bytes', internalType: 'bytes' },
      {
        name: '_finality',
        type: 'tuple',
        internalType: 'struct AtomicFinalityProof',
        components: ATOMIC_FINALITY_PROOF_COMPONENTS,
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unbundleBundle',
    inputs: [
      { name: '_bundle', type: 'bytes', internalType: 'bytes' },
      { name: '_callStatus', type: 'uint8[]', internalType: 'enum CallStatus[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyAtomicBundle',
    inputs: [
      { name: '_bundle', type: 'bytes', internalType: 'bytes' },
      {
        name: '_finality',
        type: 'tuple',
        internalType: 'struct AtomicFinalityProof',
        components: ATOMIC_FINALITY_PROOF_COMPONENTS,
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'BundleExecuted',
    inputs: [{ name: 'bundleHash', type: 'bytes32', indexed: true, internalType: 'bytes32' }],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BundleUnbundled',
    inputs: [{ name: 'bundleHash', type: 'bytes32', indexed: true, internalType: 'bytes32' }],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BundleVerified',
    inputs: [{ name: 'bundleHash', type: 'bytes32', indexed: true, internalType: 'bytes32' }],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CallProcessed',
    inputs: [
      { name: 'bundleHash', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'callIndex', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'status', type: 'uint8', indexed: false, internalType: 'enum CallStatus' },
    ],
    anonymous: false,
  },
] as const;

export default IL2InteropHandlerABI;
