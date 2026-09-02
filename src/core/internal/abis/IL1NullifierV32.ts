// The protocol-v32 L1Nullifier.
//
// Deliberately a separate ABI rather than an extension of `IL1Nullifier.ts`: v32 is not a superset
// of the pre-v32 interface. It *removed* `finalizeDeposit`, `finalizeWithdrawal`,
// `isWithdrawalFinalized`, `claimFailedDeposit`, `claimFailedDepositLegacyErc20Bridge`,
// `chainBalance`, `l2BridgeAddress`, `legacyBridge`, `transferTokenToNTV`,
// `nullifyChainBalanceByNTV` and `getTransientSettlementLayer`, and added the
// `l1InteropHandler` pair — withdrawal finalization moved to the L1InteropHandler.
const IL1NullifierV32ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'chainId',
        type: 'uint256',
      },
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'txDataHash',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'l2DepositTxHash',
        type: 'bytes32',
      },
    ],
    name: 'BridgehubDepositFinalized',
    type: 'event',
  },
  {
    inputs: [],
    name: 'BRIDGE_HUB',
    outputs: [
      {
        internalType: 'contract IL1Bridgehub',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'l1AssetRouter',
    outputs: [
      {
        internalType: 'contract IL1AssetRouter',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    // The contract that took over withdrawal finalization from the nullifier's own (removed)
    // `finalizeDeposit`.
    inputs: [],
    name: 'l1InteropHandler',
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
    name: 'l1NativeTokenVault',
    outputs: [
      {
        internalType: 'contract IL1NativeTokenVault',
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
        internalType: 'uint256',
        name: '_chainId',
        type: 'uint256',
      },
      {
        internalType: 'bytes32',
        name: '_l2TxHash',
        type: 'bytes32',
      },
    ],
    name: 'depositHappened',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32',
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
        name: '_txDataHash',
        type: 'bytes32',
      },
      {
        internalType: 'bytes32',
        name: '_txHash',
        type: 'bytes32',
      },
    ],
    name: 'bridgehubConfirmL2TransactionForwarded',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'uint256',
            name: '_chainId',
            type: 'uint256',
          },
          {
            internalType: 'address',
            name: '_depositSender',
            type: 'address',
          },
          {
            internalType: 'uint16',
            name: '_l2TxNumberInBatch',
            type: 'uint16',
          },
          {
            internalType: 'enum TxStatus',
            name: '_txStatus',
            type: 'uint8',
          },
          {
            internalType: 'bytes32',
            name: '_assetId',
            type: 'bytes32',
          },
          {
            internalType: 'bytes',
            name: '_assetData',
            type: 'bytes',
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
            internalType: 'bytes32[]',
            name: '_merkleProof',
            type: 'bytes32[]',
          },
        ],
        internalType: 'struct ConfirmTransferResultData',
        name: '_confirmTransferResultData',
        type: 'tuple',
      },
    ],
    name: 'bridgeConfirmTransferResult',
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
        internalType: 'address',
        name: '_depositSender',
        type: 'address',
      },
      {
        internalType: 'bytes32',
        name: '_assetId',
        type: 'bytes32',
      },
      {
        internalType: 'bytes',
        name: '_assetData',
        type: 'bytes',
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
    ],
    name: 'bridgeRecoverFailedTransfer',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'contract IL1NativeTokenVault',
        name: '_nativeTokenVault',
        type: 'address',
      },
    ],
    name: 'setL1NativeTokenVault',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '_l1AssetRouter',
        type: 'address',
      },
    ],
    name: 'setL1AssetRouter',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '_l1InteropHandler',
        type: 'address',
      },
    ],
    name: 'setL1InteropHandler',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export default IL1NullifierV32ABI;
