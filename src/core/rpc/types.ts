import type { Hex, Address } from '../types/primitives';

export type L2ToL1Log = {
  l2_shard_id: number;
  is_service: boolean;
  tx_number_in_block: number;
  sender: Address;
  key: Hex;
  value: Hex;
};

export type ReceiptWithL2ToL1 = {
  to: Address;
  transactionIndex: Hex;
  transactionHash?: Hex;
  status?: string | number;
  blockNumber?: string | number;
  logs?: Array<{
    address: Address;
    topics: Hex[];
    data: Hex;
    transactionHash: Hex;
  }>;
  // ZKsync-specific field
  l2ToL1Logs?: L2ToL1Log[];
};

export type ProofNormalized = {
  id: bigint;
  batchNumber: bigint;
  proof: Hex[];
  root: Hex;
  gatewayBlockNumber?: bigint;
};

export type StateCommitmentPreimage = {
  nextFreeSlot: bigint;
  blockNumber: bigint;
  last256BlockHashesBlake: Hex;
  lastBlockTimestamp: bigint;
};

export type L1VerificationData = {
  batchNumber: bigint;
  numberOfLayer1Txs: bigint;
  priorityOperationsHash: Hex;
  dependencyRootsRollingHash: Hex;
  l2ToL1LogsRootHash: Hex;
  commitment: Hex;
};

export type LeafWithProof = {
  index: bigint;
  leafKey: Hex;
  value: Hex;
  nextIndex: bigint;
  siblings: Hex[];
};

export type ExistingStorageProof = {
  type: 'existing';
  index: bigint;
  value: Hex;
  nextIndex: bigint;
  siblings: Hex[];
};

export type NonExistingStorageProof = {
  type: 'nonExisting';
  leftNeighbor: LeafWithProof;
  rightNeighbor: LeafWithProof;
};

export type StorageProofEntry = {
  key: Hex;
  proof: ExistingStorageProof | NonExistingStorageProof;
};

export type BatchStorageProof = {
  address: Address;
  stateCommitmentPreimage: StateCommitmentPreimage;
  storageProofs: StorageProofEntry[];
  l1VerificationData: L1VerificationData;
};

export type GenesisContractDeployment = {
  address: Address;
  bytecode: Hex;
};

export type GenesisStorageEntry =
  | { format: 'raw'; key: Hex; value: Hex } // key = hashed_key
  | { format: 'pretty'; address: Address; key: Hex; value: Hex }; // key = slot

export type GenesisInput = {
  initialContracts: GenesisContractDeployment[];
  additionalStorage: GenesisStorageEntry[];
  genesisRoot: Hex;
};

export type BlockMetadata = {
  pubdataPricePerByte: bigint;
  nativePrice: bigint;
  executionVersion: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcTransport = (method: string, params?: unknown[]) => Promise<any>;
