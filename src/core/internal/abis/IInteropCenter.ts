const IInteropCenterABI = [
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
        name: '',
        type: 'bytes32',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

export default IInteropCenterABI;
