// Snapshot: matter-labs/era-contracts PR #2280 head b4d3487a169dfa3f53dc8aa9f3ff1a6d4b254df7.
const IAtomicFlowManagerABI = [
  {
    type: 'function',
    name: 'commitmentTree',
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
