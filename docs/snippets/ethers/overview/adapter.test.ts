import { describe, it } from 'bun:test';

// ANCHOR: ethers-adapter-imports
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../../src/adapters/ethers';
import { ETH_ADDRESS } from '../../../../src/core';
// ANCHOR_END: ethers-adapter-imports

describe('ethers adapter setup', () => {
it('inits a basic ethers adapter and creates a deposit', async () => {
const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2 = new JsonRpcProvider(process.env.L2_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);

// ANCHOR: ethers-deposit
const params = {
  amount: parseEther('0.1'),
  to: await signer.getAddress() as `0x${string}`,
  token: ETH_ADDRESS,
} as const;

const handle = await sdk.deposits.create(params);
await sdk.deposits.wait(handle, { for: 'l2' }); // funds available on L2
// ANCHOR_END: ethers-deposit
});

});
