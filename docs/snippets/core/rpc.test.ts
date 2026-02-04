import { beforeAll, describe, expect, it } from 'bun:test';

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, type ViemClient } from '../../../src/adapters/viem';
import { Address, Hex, type ZksRpc as ZksType } from '../../../src/core';
import { GenesisContractDeployment, GenesisInput as GenesisType, GenesisStorageEntry, L2ToL1Log, ProofNormalized as ProofN, ReceiptWithL2ToL1 as RWithLog } from '../../../src/core/rpc/types';

import { l1Chain, l2Chain } from '../viem/chains';
import type { Exact } from "./types";

// ANCHOR: zks-rpc
interface ZksRpc {
  getBridgehubAddress(): Promise<Address>;
  getL2ToL1LogProof(txHash: Hex, index: number): Promise<ProofNormalized>;
  getReceiptWithL2ToL1(txHash: Hex): Promise<ReceiptWithL2ToL1 | null>;
  getGenesis(): Promise<GenesisInput>;
}
// ANCHOR_END: zks-rpc

// ANCHOR: proof-receipt-type
type ProofNormalized = {
  id: bigint;
  batchNumber: bigint;
  proof: Hex[];
};

type ReceiptWithL2ToL1 = {
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
// ANCHOR_END: proof-receipt-type

// ANCHOR: genesis-type
export type GenesisInput = {
  initialContracts: GenesisContractDeployment[];
  additionalStorage: GenesisStorageEntry[];
  executionVersion: number;
  genesisRoot: Hex;
};
// ANCHOR_END: genesis-type

describe('checks rpc docs examples', () => {

let client: ViemClient;

beforeAll(() => {
  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

  const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
  const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
  const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(process.env.L1_RPC!) });
  const l2Wallet = createWalletClient({ chain: l2Chain, account, transport: http(process.env.L2_RPC!) });

  client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
})

// this test will always succeed
// but any errors will be highlighted
it('checks to see if the zks rpc types are updated', async () => {
    const _rpcType: Exact<ZksRpc, ZksType> = true;
    const _proofType: Exact<ProofNormalized, ProofN> = true;
    const _receiptType: Exact<ReceiptWithL2ToL1, RWithLog> = true;
    const _genesisType: Exact<GenesisInput, GenesisType> = true;
});

it('tries to get the bridehub address', async () => {
// ANCHOR: bridgehub-address
const addr = await client.zks.getBridgehubAddress();
// ANCHOR_END: bridgehub-address
expect(addr).toContain("0x");
});

it('tries to get the genesis', async () => {
// ANCHOR: genesis-method
const genesis = await client.zks.getGenesis();

for (const contract of genesis.initialContracts) {
  console.log('Contract at', contract.address, 'with bytecode', contract.bytecode);
}

console.log('Execution version:', genesis.executionVersion);
console.log('Genesis root:', genesis.genesisRoot);
// ANCHOR_END: genesis-method
expect(genesis.initialContracts).toBeArray();
});

});
