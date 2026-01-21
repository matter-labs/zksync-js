const IInteropHandlerABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'bundleHash',
        type: 'bytes32',
      },
    ],
    name: 'BundleExecuted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'bundleHash',
        type: 'bytes32',
      },
    ],
    name: 'BundleUnbundled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'bundleHash',
        type: 'bytes32',
      },
    ],
    name: 'BundleVerified',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'bundleHash',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'uint256',
        name: 'callIndex',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'enum CallStatus',
        name: 'status',
        type: 'uint8',
      },
    ],
    name: 'CallProcessed',
    type: 'event',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: '_bundle',
        type: 'bytes',
      },
      {
        components: [
          {
            internalType: 'uint256',
            name: 'chainId',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'l1BatchNumber',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'l2MessageIndex',
            type: 'uint256',
          },
          {
            components: [
              {
                internalType: 'uint16',
                name: 'txNumberInBatch',
                type: 'uint16',
              },
              {
                internalType: 'address',
                name: 'sender',
                type: 'address',
              },
              {
                internalType: 'bytes',
                name: 'data',
                type: 'bytes',
              },
            ],
            internalType: 'struct L2Message',
            name: 'message',
            type: 'tuple',
          },
          {
            internalType: 'bytes32[]',
            name: 'proof',
            type: 'bytes32[]',
          },
        ],
        internalType: 'struct MessageInclusionProof',
        name: '_proof',
        type: 'tuple',
      },
    ],
    name: 'executeBundle',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '_sourceChainId',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: '_bundle',
        type: 'bytes',
      },
      {
        internalType: 'enum CallStatus[]',
        name: '_callStatus',
        type: 'uint8[]',
      },
    ],
    name: 'unbundleBundle',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: '_bundle',
        type: 'bytes',
      },
      {
        components: [
          {
            internalType: 'uint256',
            name: 'chainId',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'l1BatchNumber',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'l2MessageIndex',
            type: 'uint256',
          },
          {
            components: [
              {
                internalType: 'uint16',
                name: 'txNumberInBatch',
                type: 'uint16',
              },
              {
                internalType: 'address',
                name: 'sender',
                type: 'address',
              },
              {
                internalType: 'bytes',
                name: 'data',
                type: 'bytes',
              },
            ],
            internalType: 'struct L2Message',
            name: 'message',
            type: 'tuple',
          },
          {
            internalType: 'bytes32[]',
            name: 'proof',
            type: 'bytes32[]',
          },
        ],
        internalType: 'struct MessageInclusionProof',
        name: '_proof',
        type: 'tuple',
      },
    ],
    name: 'verifyBundle',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export default IInteropHandlerABI;
