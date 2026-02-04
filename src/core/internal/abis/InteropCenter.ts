const InteropCenterABI = [
  {
    inputs: [
      {
        internalType: 'bytes4',
        name: 'selector',
        type: 'bytes4',
      },
    ],
    name: 'AttributeAlreadySet',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes4',
        name: 'selector',
        type: 'bytes4',
      },
      {
        internalType: 'uint256',
        name: 'restriction',
        type: 'uint256',
      },
    ],
    name: 'AttributeViolatesRestriction',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'expected',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'actual',
        type: 'uint256',
      },
    ],
    name: 'IndirectCallValueMismatch',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: 'interoperableAddress',
        type: 'bytes',
      },
    ],
    name: 'InteroperableAddressChainReferenceNotEmpty',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: 'interoperableAddress',
        type: 'bytes',
      },
    ],
    name: 'InteroperableAddressNotEmpty',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: '',
        type: 'bytes',
      },
    ],
    name: 'InteroperableAddressParsingError',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'expectedMsgValue',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'providedMsgValue',
        type: 'uint256',
      },
    ],
    name: 'MsgValueMismatch',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotInGatewayMode',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'sourceChainId',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'destinationChainId',
        type: 'uint256',
      },
    ],
    name: 'NotL2ToL2',
    type: 'error',
  },
  {
    inputs: [],
    name: 'SlotOccupied',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'caller',
        type: 'address',
      },
    ],
    name: 'Unauthorized',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes4',
        name: 'selector',
        type: 'bytes4',
      },
    ],
    name: 'UnsupportedAttribute',
    type: 'error',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint8',
        name: 'version',
        type: 'uint8',
      },
    ],
    name: 'Initialized',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'l2l1MsgHash',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'interopBundleHash',
        type: 'bytes32',
      },
      {
        components: [
          {
            internalType: 'bytes1',
            name: 'version',
            type: 'bytes1',
          },
          {
            internalType: 'uint256',
            name: 'sourceChainId',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'destinationChainId',
            type: 'uint256',
          },
          {
            internalType: 'bytes32',
            name: 'interopBundleSalt',
            type: 'bytes32',
          },
          {
            components: [
              {
                internalType: 'bytes1',
                name: 'version',
                type: 'bytes1',
              },
              {
                internalType: 'bool',
                name: 'shadowAccount',
                type: 'bool',
              },
              {
                internalType: 'address',
                name: 'to',
                type: 'address',
              },
              {
                internalType: 'address',
                name: 'from',
                type: 'address',
              },
              {
                internalType: 'uint256',
                name: 'value',
                type: 'uint256',
              },
              {
                internalType: 'bytes',
                name: 'data',
                type: 'bytes',
              },
            ],
            internalType: 'struct InteropCall[]',
            name: 'calls',
            type: 'tuple[]',
          },
          {
            components: [
              {
                internalType: 'bytes',
                name: 'executionAddress',
                type: 'bytes',
              },
              {
                internalType: 'bytes',
                name: 'unbundlerAddress',
                type: 'bytes',
              },
            ],
            internalType: 'struct BundleAttributes',
            name: 'bundleAttributes',
            type: 'tuple',
          },
        ],
        indexed: false,
        internalType: 'struct InteropBundle',
        name: 'interopBundle',
        type: 'tuple',
      },
    ],
    name: 'InteropBundleSent',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'sendId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'sender',
        type: 'bytes',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'recipient',
        type: 'bytes',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'payload',
        type: 'bytes',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'value',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'bytes[]',
        name: 'attributes',
        type: 'bytes[]',
      },
    ],
    name: 'MessageSent',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'oldAssetRouter',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newAssetRouter',
        type: 'address',
      },
    ],
    name: 'NewAssetRouter',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'oldAssetTracker',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newAssetTracker',
        type: 'address',
      },
    ],
    name: 'NewAssetTracker',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'previousOwner',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'OwnershipTransferStarted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'previousOwner',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'OwnershipTransferred',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'Paused',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'Unpaused',
    type: 'event',
  },
  {
    inputs: [],
    name: 'L1_CHAIN_ID',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'acceptOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
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
        name: '_canonicalTxHash',
        type: 'bytes32',
      },
      {
        internalType: 'uint64',
        name: '_expirationTimestamp',
        type: 'uint64',
      },
      {
        components: [
          {
            internalType: 'bytes1',
            name: 'version',
            type: 'bytes1',
          },
          {
            internalType: 'address',
            name: 'originToken',
            type: 'address',
          },
          {
            internalType: 'bytes32',
            name: 'baseTokenAssetId',
            type: 'bytes32',
          },
          {
            internalType: 'uint256',
            name: 'baseTokenAmount',
            type: 'uint256',
          },
          {
            internalType: 'bytes32',
            name: 'assetId',
            type: 'bytes32',
          },
          {
            internalType: 'uint256',
            name: 'amount',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'tokenOriginChainId',
            type: 'uint256',
          },
        ],
        internalType: 'struct BalanceChange',
        name: '_balanceChange',
        type: 'tuple',
      },
    ],
    name: 'forwardTransactionOnGatewayWithBalanceChange',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '_l1ChainId',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: '_owner',
        type: 'address',
      },
    ],
    name: 'initL2',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
    ],
    name: 'interopBundleNonce',
    outputs: [
      {
        internalType: 'uint256',
        name: 'numberOfBundlesSent',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes[]',
        name: '_attributes',
        type: 'bytes[]',
      },
      {
        internalType: 'enum IInteropCenter.AttributeParsingRestrictions',
        name: '_restriction',
        type: 'uint8',
      },
    ],
    name: 'parseAttributes',
    outputs: [
      {
        components: [
          {
            internalType: 'uint256',
            name: 'interopCallValue',
            type: 'uint256',
          },
          {
            internalType: 'bool',
            name: 'indirectCall',
            type: 'bool',
          },
          {
            internalType: 'uint256',
            name: 'indirectCallMessageValue',
            type: 'uint256',
          },
        ],
        internalType: 'struct CallAttributes',
        name: 'callAttributes',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'bytes',
            name: 'executionAddress',
            type: 'bytes',
          },
          {
            internalType: 'bytes',
            name: 'unbundlerAddress',
            type: 'bytes',
          },
        ],
        internalType: 'struct BundleAttributes',
        name: 'bundleAttributes',
        type: 'tuple',
      },
    ],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [],
    name: 'pause',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'paused',
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
    inputs: [],
    name: 'pendingOwner',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: '_destinationChainId',
        type: 'bytes',
      },
      {
        components: [
          {
            internalType: 'bytes',
            name: 'to',
            type: 'bytes',
          },
          {
            internalType: 'bytes',
            name: 'data',
            type: 'bytes',
          },
          {
            internalType: 'bytes[]',
            name: 'callAttributes',
            type: 'bytes[]',
          },
        ],
        internalType: 'struct InteropCallStarter[]',
        name: '_callStarters',
        type: 'tuple[]',
      },
      {
        internalType: 'bytes[]',
        name: '_bundleAttributes',
        type: 'bytes[]',
      },
    ],
    name: 'sendBundle',
    outputs: [
      {
        internalType: 'bytes32',
        name: 'bundleHash',
        type: 'bytes32',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: 'recipient',
        type: 'bytes',
      },
      {
        internalType: 'bytes',
        name: 'payload',
        type: 'bytes',
      },
      {
        internalType: 'bytes[]',
        name: 'attributes',
        type: 'bytes[]',
      },
    ],
    name: 'sendMessage',
    outputs: [
      {
        internalType: 'bytes32',
        name: 'sendId',
        type: 'bytes32',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes4',
        name: '_attributeSelector',
        type: 'bytes4',
      },
    ],
    name: 'supportsAttribute',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'unpause',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export default InteropCenterABI;
