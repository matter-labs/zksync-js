const IInteropErrorsABI = [
  {
    type: 'error',
    name: 'AttributeAlreadySet',
    inputs: [
      {
        name: 'selector',
        type: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'AttributeViolatesRestriction',
    inputs: [
      {
        name: 'selector',
        type: 'bytes4',
      },
      {
        name: 'restriction',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'BundleAlreadyProcessed',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'CallAlreadyExecuted',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
      },
      {
        name: 'callIndex',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'CallNotExecutable',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
      },
      {
        name: 'callIndex',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'CanNotUnbundle',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'DestinationChainNotRegistered',
    inputs: [
      {
        name: 'destinationChainId',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ExecutingNotAllowed',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
      },
      {
        name: 'callerAddress',
        type: 'bytes',
      },
      {
        name: 'executionAddress',
        type: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'FeeWithdrawalFailed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'IndirectCallValueMismatch',
    inputs: [
      {
        name: 'expected',
        type: 'uint256',
      },
      {
        name: 'actual',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'InteroperableAddressChainReferenceNotEmpty',
    inputs: [
      {
        name: 'interoperableAddress',
        type: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InteroperableAddressNotEmpty',
    inputs: [
      {
        name: 'interoperableAddress',
        type: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidInteropBundleVersion',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidInteropCallVersion',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InteropRootAlreadyExists',
    inputs: [],
  },
  {
    type: 'error',
    name: 'MessageNotIncluded',
    inputs: [],
  },
  {
    type: 'error',
    name: 'SidesLengthNotOne',
    inputs: [],
  },
  {
    type: 'error',
    name: 'UnauthorizedMessageSender',
    inputs: [
      {
        name: 'expected',
        type: 'address',
      },
      {
        name: 'actual',
        type: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'UnbundlingNotAllowed',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
      },
      {
        name: 'callerAddress',
        type: 'bytes',
      },
      {
        name: 'unbundlerAddress',
        type: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'WrongCallStatusLength',
    inputs: [
      {
        name: 'bundleCallsLength',
        type: 'uint256',
      },
      {
        name: 'providedCallStatusLength',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'WrongDestinationChainId',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
      },
      {
        name: 'expected',
        type: 'uint256',
      },
      {
        name: 'actual',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'WrongDestinationBaseTokenAssetId',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
      },
      {
        name: 'expected',
        type: 'bytes32',
      },
      {
        name: 'actual',
        type: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'WrongSourceChainId',
    inputs: [
      {
        name: 'bundleHash',
        type: 'bytes32',
      },
      {
        name: 'expected',
        type: 'uint256',
      },
      {
        name: 'actual',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ZKTokenNotAvailable',
    inputs: [],
  },
] as const;

export default IInteropErrorsABI;
