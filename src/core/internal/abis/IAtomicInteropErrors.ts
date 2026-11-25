// Custom errors of the atomic-interop contracts (era-contracts
// `l1-contracts/contracts/atomic-interop/AtomicInteropErrors.sol`): the AtomicFlowManager, the
// interop commitment tree and the AtomicInteropProof library, which the InteropHandler reaches through
// `requireFlowFinalized`.
const IAtomicInteropErrorsABI = [
  {
    type: 'error',
    name: 'CommitmentTreeNotAppender',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InteropCommitmentLeafHookFailed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ManagerAlreadyInitialized',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ManagerBundleHashesNotSorted',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ManagerCommittedBundleNotInFlow',
    inputs: [
      { name: 'flowId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'bundleHash', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerCommittedLegSourceChainMismatch',
    inputs: [
      { name: 'flowId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'thisChainId', type: 'uint256', internalType: 'uint256' },
      { name: 'declaredSourceChainId', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerExecutingBundleNotInFlow',
    inputs: [
      { name: 'flowId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'bundleHash', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerFlowDeadlinePassed',
    inputs: [
      { name: 'deadline', type: 'uint64', internalType: 'uint64' },
      { name: 'latestImportedRootTimestamp', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerFlowIdMismatch',
    inputs: [
      { name: 'expected', type: 'bytes32', internalType: 'bytes32' },
      { name: 'computed', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerFlowPreimageVersionMismatch',
    inputs: [
      { name: 'expected', type: 'bytes1', internalType: 'bytes1' },
      { name: 'actual', type: 'bytes1', internalType: 'bytes1' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerL1ChainIdZero',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ManagerLegAlreadyCommitted',
    inputs: [
      { name: 'flowId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'bundleHash', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerLegNotRevertable',
    inputs: [
      { name: 'flowId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'bundleHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'actual', type: 'uint8', internalType: 'enum LegState' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerLegSourceChainIdsLengthMismatch',
    inputs: [
      { name: 'legs', type: 'uint256', internalType: 'uint256' },
      { name: 'chainIds', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerLegSourceChainNotAllowed',
    inputs: [{ name: 'legSourceChainId', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'error',
    name: 'ManagerLegSourceChainNotRegistered',
    inputs: [{ name: 'legSourceChainId', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'error',
    name: 'ManagerMissingLegIndexOutOfRange',
    inputs: [
      { name: 'legs', type: 'uint256', internalType: 'uint256' },
      { name: 'missingLegIndex', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerNotInteropCenter',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'ManagerNotInteropHandler',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'ManagerProofCountMismatch',
    inputs: [
      { name: 'legs', type: 'uint256', internalType: 'uint256' },
      { name: 'proofs', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerSettlementLayerNotL1',
    inputs: [
      { name: 'expectedL1ChainId', type: 'uint256', internalType: 'uint256' },
      { name: 'actual', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ManagerTooManyLegs',
    inputs: [
      { name: 'maxLegs', type: 'uint256', internalType: 'uint256' },
      { name: 'legs', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ProofDeadlineExceeded',
    inputs: [
      { name: 'batchTimestamp', type: 'uint256', internalType: 'uint256' },
      { name: 'deadline', type: 'uint64', internalType: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'ProofImtRootInclusionFailed',
    inputs: [
      { name: 'chainId', type: 'uint256', internalType: 'uint256' },
      { name: 'batchNumber', type: 'uint256', internalType: 'uint256' },
      { name: 'imtRoot', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'ProofInclusionFailed',
    inputs: [
      { name: 'root', type: 'bytes32', internalType: 'bytes32' },
      { name: 'value', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ProofInteropRootNotAfterDeadline',
    inputs: [
      { name: 'rootTimestamp', type: 'uint256', internalType: 'uint256' },
      { name: 'deadline', type: 'uint64', internalType: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'ProofInvalidChainBatchRootDepth',
    inputs: [
      { name: 'expected', type: 'uint256', internalType: 'uint256' },
      { name: 'actual', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ProofMissingSettlementLayerBatch',
    inputs: [
      { name: 'chainId', type: 'uint256', internalType: 'uint256' },
      { name: 'batchNumber', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ProofNonInclusionFailed',
    inputs: [
      { name: 'root', type: 'bytes32', internalType: 'bytes32' },
      { name: 'value', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ProofNotLastBatchInRoot',
    inputs: [
      { name: 'level', type: 'uint256', internalType: 'uint256' },
      { name: 'sibling', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'ProofSettlementLayerInteropRootNotImported',
    inputs: [
      { name: 'slChainId', type: 'uint256', internalType: 'uint256' },
      { name: 'slBlock', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ProofSettlementLayerMismatch',
    inputs: [
      { name: 'expectedSlChainId', type: 'uint256', internalType: 'uint256' },
      { name: 'proofSlChainId', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ProofSourceChainMismatch',
    inputs: [
      { name: 'expectedSourceChainId', type: 'uint256', internalType: 'uint256' },
      { name: 'proofSourceChainId', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ProofTimeoutBranchMismatch',
    inputs: [
      { name: 'provesAgainstBeginRoot', type: 'bool', internalType: 'bool' },
      { name: 'l1BatchTimestamp', type: 'uint256', internalType: 'uint256' },
      { name: 'deadline', type: 'uint256', internalType: 'uint256' },
    ],
  },
] as const;

export default IAtomicInteropErrorsABI;
