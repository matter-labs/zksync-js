const L2MessageVerificationABI = [
  {
    inputs: [],
    name: 'DepthMoreThanOneForRecursiveMerkleProof',
    type: 'error',
  },
  {
    inputs: [],
    name: 'HashedLogIsDefault',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidProofLengthForFinalNode',
    type: 'error',
  },
  {
    inputs: [],
    name: 'MerkleIndexOutOfBounds',
    type: 'error',
  },
  {
    inputs: [],
    name: 'MerklePathEmpty',
    type: 'error',
  },
  {
    inputs: [],
    name: 'MerklePathOutOfBounds',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'metadataVersion',
        type: 'uint256',
      },
    ],
    name: 'UnsupportedProofMetadataVersion',
    type: 'error',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'uint256',
            name: 'chainId',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'l2BatchNumber',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'l2MessageIndex',
            type: 'uint256',
          },
          {
            internalType: 'address',
            name: 'l2Sender',
            type: 'address',
          },
          {
            internalType: 'uint16',
            name: 'l2TxNumberInBatch',
            type: 'uint16',
          },
          {
            internalType: 'bytes',
            name: 'message',
            type: 'bytes',
          },
          {
            internalType: 'bytes32[]',
            name: 'merkleProof',
            type: 'bytes32[]',
          },
        ],
        internalType: 'struct FinalizeL1DepositParams',
        name: '_finalizeWithdrawalParams',
        type: 'tuple',
      },
    ],
    name: 'proveL1DepositParamsInclusion',
    outputs: [
      {
        internalType: 'bool',
        name: 'success',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '_chainId',
        type: 'uint256',
      },
      {
        internalType: 'bytes32',
        name: '_l2TxHash',
        type: 'bytes32',
      },
      {
        internalType: 'uint256',
        name: '_l2BatchNumber',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_l2MessageIndex',
        type: 'uint256',
      },
      {
        internalType: 'uint16',
        name: '_l2TxNumberInBatch',
        type: 'uint16',
      },
      {
        internalType: 'bytes32[]',
        name: '_merkleProof',
        type: 'bytes32[]',
      },
      {
        internalType: 'enum TxStatus',
        name: '_status',
        type: 'uint8',
      },
    ],
    name: 'proveL1ToL2TransactionStatusShared',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '_chainId',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_blockOrBatchNumber',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_leafProofMask',
        type: 'uint256',
      },
      {
        internalType: 'bytes32',
        name: '_leaf',
        type: 'bytes32',
      },
      {
        internalType: 'bytes32[]',
        name: '_proof',
        type: 'bytes32[]',
      },
    ],
    name: 'proveL2LeafInclusionShared',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '_chainId',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_blockOrBatchNumber',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_leafProofMask',
        type: 'uint256',
      },
      {
        internalType: 'bytes32',
        name: '_leaf',
        type: 'bytes32',
      },
      {
        internalType: 'bytes32[]',
        name: '_proof',
        type: 'bytes32[]',
      },
      {
        internalType: 'uint256',
        name: '_depth',
        type: 'uint256',
      },
    ],
    name: 'proveL2LeafInclusionSharedRecursive',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '_chainId',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_blockOrBatchNumber',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_index',
        type: 'uint256',
      },
      {
        components: [
          {
            internalType: 'uint8',
            name: 'l2ShardId',
            type: 'uint8',
          },
          {
            internalType: 'bool',
            name: 'isService',
            type: 'bool',
          },
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
            internalType: 'bytes32',
            name: 'key',
            type: 'bytes32',
          },
          {
            internalType: 'bytes32',
            name: 'value',
            type: 'bytes32',
          },
        ],
        internalType: 'struct L2Log',
        name: '_log',
        type: 'tuple',
      },
      {
        internalType: 'bytes32[]',
        name: '_proof',
        type: 'bytes32[]',
      },
    ],
    name: 'proveL2LogInclusionShared',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '_chainId',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_blockOrBatchNumber',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_index',
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
        name: '_message',
        type: 'tuple',
      },
      {
        internalType: 'bytes32[]',
        name: '_proof',
        type: 'bytes32[]',
      },
    ],
    name: 'proveL2MessageInclusionShared',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export default L2MessageVerificationABI;
