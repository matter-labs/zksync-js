// Snapshot: matter-labs/era-contracts PR #2280 head b4d3487a169dfa3f53dc8aa9f3ff1a6d4b254df7.
const callStarter = {
  name: '_callStarters',
  type: 'tuple[]',
  internalType: 'struct InteropCallStarter[]',
  components: [
    { name: 'to', type: 'bytes', internalType: 'bytes' },
    { name: 'data', type: 'bytes', internalType: 'bytes' },
    { name: 'callAttributes', type: 'bytes[]', internalType: 'bytes[]' },
  ],
} as const;

const interopCall = {
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
} as const;

const bundleAttributes = {
  name: 'bundleAttributes',
  type: 'tuple',
  internalType: 'struct BundleAttributes',
  components: [
    { name: 'executionAddress', type: 'bytes', internalType: 'bytes' },
    { name: 'unbundlerAddress', type: 'bytes', internalType: 'bytes' },
    { name: 'useFixedFee', type: 'bool', internalType: 'bool' },
    { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
  ],
} as const;

const IInteropCenterABI = [
  {
    type: 'function',
    name: 'ZK_INTEROP_FEE',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'interopProtocolFee',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isInteropBundleSaltUsed',
    inputs: [
      { name: 'user', type: 'address', internalType: 'address' },
      { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'previewBundleHash',
    inputs: [
      { name: '_destinationChainId', type: 'bytes', internalType: 'bytes' },
      callStarter,
      { name: '_bundleAttributes', type: 'bytes[]', internalType: 'bytes[]' },
    ],
    outputs: [{ name: 'bundleHash', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'sendBundle',
    inputs: [
      { name: '_destinationChainId', type: 'bytes', internalType: 'bytes' },
      callStarter,
      { name: '_bundleAttributes', type: 'bytes[]', internalType: 'bytes[]' },
    ],
    outputs: [{ name: 'bundleHash', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'zkToken',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract IERC20' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'InteropBundleSent',
    inputs: [
      { name: 'l2l1MsgHash', type: 'bytes32', indexed: false, internalType: 'bytes32' },
      { name: 'interopBundleHash', type: 'bytes32', indexed: false, internalType: 'bytes32' },
      {
        name: 'interopBundle',
        type: 'tuple',
        indexed: false,
        internalType: 'struct InteropBundle',
        components: [
          { name: 'version', type: 'bytes1', internalType: 'bytes1' },
          { name: 'sourceChainId', type: 'uint256', internalType: 'uint256' },
          { name: 'destinationChainId', type: 'uint256', internalType: 'uint256' },
          {
            name: 'destinationBaseTokenAssetId',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          { name: 'interopBundleSalt', type: 'bytes32', internalType: 'bytes32' },
          interopCall,
          bundleAttributes,
        ],
      },
    ],
    anonymous: false,
  },
] as const;

export default IInteropCenterABI;
