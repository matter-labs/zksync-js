const InteropRootStorageABI = [
  {
    type: 'function',
    name: 'interopRoots',
    inputs: [
      {
        name: 'chainId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'blockOrBatchNumber',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'InteropRootAdded',
    inputs: [
      {
        name: 'chainId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'blockNumber',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'sides',
        type: 'bytes32[]',
        indexed: false,
        internalType: 'bytes32[]',
      },
    ],
    anonymous: false,
  },
] as const;

export default InteropRootStorageABI;
