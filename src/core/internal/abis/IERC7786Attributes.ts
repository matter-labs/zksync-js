// Snapshot: matter-labs/era-contracts PR #2280 head b4d3487a169dfa3f53dc8aa9f3ff1a6d4b254df7.
const IERC7786AttributesABI = [
  {
    type: 'function',
    name: 'atomicBundle',
    inputs: [
      { name: '_flowId', type: 'bytes32', internalType: 'bytes32' },
      { name: '_deadline', type: 'uint64', internalType: 'uint64' },
      { name: '_lowNullifierIndex', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'executionAddress',
    inputs: [{ name: '_executionAddress', type: 'bytes', internalType: 'bytes' }],
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
    name: 'interopBundleSalt',
    inputs: [{ name: '_salt', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'interopCallValue',
    inputs: [{ name: '_interopCallValue', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'useFixedFee',
    inputs: [{ name: '_useFixed', type: 'bool', internalType: 'bool' }],
    outputs: [],
    stateMutability: 'pure',
  },
] as const;

export default IERC7786AttributesABI;
