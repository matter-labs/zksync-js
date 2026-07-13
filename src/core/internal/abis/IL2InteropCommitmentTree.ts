// Snapshot: matter-labs/era-contracts PR #2280 head b4d3487a169dfa3f53dc8aa9f3ff1a6d4b254df7.
const IL2InteropCommitmentTreeABI = [
  {
    type: 'function',
    name: 'leafAt',
    inputs: [{ name: '_index', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IMTLeaf',
        components: [
          { name: 'value', type: 'uint256', internalType: 'uint256' },
          { name: 'nextIndex', type: 'uint256', internalType: 'uint256' },
          { name: 'nextValue', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'leafCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export default IL2InteropCommitmentTreeABI;
