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
  transactionHash?: Hex;
  status?: string | number;
  blockNumber?: string | number;
  logs?: Array<{
    address: Address;
    topics: Hex[];
    data: Hex;
  }>;
  // ZKsync-specific field
  l2ToL1Logs?: L2ToL1Log[];
};

export type ProofNormalized = {
  id: bigint;
  batchNumber: bigint;
  proof: Hex[];
};

export type GenesisContractDeployment = {
  address: Address;
  bytecode: Hex;
};

export type GenesisStorageEntry = {
  key: Hex;
  value: Hex;
};

export type GenesisInput = {
  initialContracts: GenesisContractDeployment[];
  additionalStorage: GenesisStorageEntry[];
  executionVersion: number;
  genesisRoot: Hex;
};

export type BlockMetadata = {
  pubdataPricePerByte: bigint;
  nativePrice: bigint;
  executionVersion: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcTransport = (method: string, params?: unknown[]) => Promise<any>;
