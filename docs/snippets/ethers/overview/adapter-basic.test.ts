import { describe, it } from 'bun:test';

// ANCHOR: ethers-basic-imports
import { JsonRpcProvider, Wallet } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../../src/adapters/ethers';
// ANCHOR_END: ethers-basic-imports

describe('ethers basic setup', () => {
it('inits a basic ethers adapter and creates a deposit', async () => {
// ANCHOR: init-ethers-adapter
const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2 = new JsonRpcProvider(process.env.L2_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);
// ANCHOR_END: init-ethers-adapter
});

});
