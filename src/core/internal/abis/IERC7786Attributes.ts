const IERC7786AttributesABI = [
  {
    inputs: [
      {
        internalType: 'bytes',
        name: '_executionAddress',
        type: 'bytes',
      },
    ],
    name: 'executionAddress',
    outputs: [],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '_indirectCallMessageValue',
        type: 'uint256',
      },
    ],
    name: 'indirectCall',
    outputs: [],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '_interopCallValue',
        type: 'uint256',
      },
    ],
    name: 'interopCallValue',
    outputs: [],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: '_unbundlerAddress',
        type: 'bytes',
      },
    ],
    name: 'unbundlerAddress',
    outputs: [],
    stateMutability: 'pure',
    type: 'function',
  },
] as const;

export default IERC7786AttributesABI;
