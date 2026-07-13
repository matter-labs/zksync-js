// L2 atomic handler subset. L1 withdrawal execution uses IL1InteropHandlerABI.
const IInteropHandlerABI = [
  {
    type: 'function',
    name: 'bundleStatus',
    inputs: [{ name: 'bundleHash', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'enum IInteropHandlerBase.BundleStatus',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'BundleExecuted',
    inputs: [{ name: 'bundleHash', type: 'bytes32', indexed: true, internalType: 'bytes32' }],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BundleUnbundled',
    inputs: [{ name: 'bundleHash', type: 'bytes32', indexed: true, internalType: 'bytes32' }],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BundleVerified',
    inputs: [{ name: 'bundleHash', type: 'bytes32', indexed: true, internalType: 'bytes32' }],
    anonymous: false,
  },
] as const;

export default IInteropHandlerABI;
