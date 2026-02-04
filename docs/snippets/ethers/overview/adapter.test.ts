import { describe, expect, it } from 'bun:test';

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

// ANCHOR: mental-model
// Instead of this:
try {
  const handle = await sdk.withdrawals.create(params);
  // ... happy path
} catch (error) {
  // ... sad path
}

// You can do this:
const result = await sdk.withdrawals.tryCreate(params);

if (result.ok) {
  // Safe to use result.value, which is the WithdrawHandle
  const handle = result.value;
} else {
  // Handle the error explicitly
  console.error('Withdrawal failed:', result.error);
}
// ANCHOR_END: mental-model
expect(result.ok).toEqual(true);

// ANCHOR: simple-flow
// 1. Create the deposit
const depositHandle = await sdk.deposits.create(params);

// 2. Wait for it to be finalized on L2
const receipt = await sdk.deposits.wait(depositHandle, { for: 'l2' });

console.log('Deposit complete!');
// ANCHOR_END: simple-flow
expect(receipt?.hash).toContain("0x");
});

});
