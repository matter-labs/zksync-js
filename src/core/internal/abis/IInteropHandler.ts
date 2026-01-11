const IInteropHandlerABI = [
  {
    type: 'function',
    name: 'executeBundle',
    inputs: [
      {
        name: '_bundle',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: '_proof',
        type: 'tuple',
        internalType: 'struct MessageInclusionProof',
        components: [
          {
            name: 'chainId',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'l1BatchNumber',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'l2MessageIndex',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'message',
            type: 'tuple',
            internalType: 'struct L2Message',
            components: [
              {
                name: 'txNumberInBatch',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'sender',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'data',
                type: 'bytes',
                internalType: 'bytes',
              },
            ],
          },
          {
            name: 'proof',
            type: 'bytes32[]',
            internalType: 'bytes32[]',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unbundleBundle',
    inputs: [
      {
        name: '_sourceChainId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: '_bundle',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: '_callStatus',
        type: 'uint8[]',
        internalType: 'enum CallStatus[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyBundle',
    inputs: [
      {
        name: '_bundle',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: '_proof',
        type: 'tuple',
        internalType: 'struct MessageInclusionProof',
        components: [
          {
            name: 'chainId',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'l1BatchNumber',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'l2MessageIndex',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'message',
            type: 'tuple',
            internalType: 'struct L2Message',
            components: [
              {
                name: 'txNumberInBatch',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'sender',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'data',
                type: 'bytes',
                internalType: 'bytes',
              },
            ],
          },
          {
            name: 'proof',
            type: 'bytes32[]',
            internalType: 'bytes32[]',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'BundleExecuted',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BundleUnbundled',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BundleVerified',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CallProcessed',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'callIndex',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'status',
        type: 'uint8',
        indexed: false,
        internalType: 'enum CallStatus',
      },
    ],
    anonymous: false,
  },
] as const;

export default IInteropHandlerABI;
