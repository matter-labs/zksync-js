import { ATOMIC_FLOW_PREIMAGE_COMPONENTS } from './AtomicInteropTypes';

const IERC7786AttributesABI = [
  {
    // Atomic interop (bundle attribute): marks the bundle as a leg of the flow whose full preimage
    // it carries. The preimage's `bytes1 version` is part of the selector.
    type: 'function',
    name: 'atomicBundle',
    inputs: [
      {
        name: '_flowPreimage',
        type: 'tuple',
        internalType: 'struct AtomicFlowPreimage',
        components: ATOMIC_FLOW_PREIMAGE_COMPONENTS,
      },
      {
        name: '_lowNullifierIndex',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'executionAddress',
    inputs: [
      {
        name: '_executionAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'indirectCall',
    inputs: [
      {
        name: '_indirectCallMessageValue',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'interopCallValue',
    inputs: [
      {
        name: '_interopCallValue',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'interopBundleSalt',
    inputs: [
      {
        name: '_salt',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'unbundlerAddress',
    inputs: [
      {
        name: '_unbundlerAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'useFixedFee',
    inputs: [
      {
        name: '_useFixed',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    outputs: [],
    stateMutability: 'pure',
  },
] as const;

export default IERC7786AttributesABI;
