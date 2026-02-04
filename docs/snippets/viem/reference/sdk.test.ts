import { beforeAll, describe, expect, it } from 'bun:test';

// ANCHOR: viem-import
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
// ANCHOR_END: viem-import
// ANCHOR: eth-import
import { ETH_ADDRESS } from '../../../../src/core';
// ANCHOR_END: eth-import
// ANCHOR: sdk-import
import { createViemClient, createViemSdk } from '../../../../src/adapters/viem';
// ANCHOR_END: sdk-import
import type { ViemSdk } from '../../../../src/adapters/viem';
import type { Account } from 'viem';
import { l1Chain, l2Chain } from '../chains';

describe('viem sdk', () => {

let viemSDK: ViemSdk;
let me: Account;

beforeAll(() => {
// ANCHOR: init-sdk
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(process.env.L1_RPC!) });
const l2Wallet = createWalletClient({ chain: l2Chain, account, transport: http(process.env.L2_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
const sdk = createViemSdk(client);
// ANCHOR_END: init-sdk
viemSDK = sdk;
me = account;
})

it('tests the viem sdk', async () => {
  const sdk = viemSDK;
  const account = me;
// ANCHOR: basic-sdk
// Example: deposit 0.05 ETH L1 → L2, wait for L2 execution
const handle = await sdk.deposits.create({
  token: ETH_ADDRESS,               // 0x…00 sentinel for ETH
  amount: 50_000_000_000_000_000n,  // 0.05 ETH in wei
  to: account.address,
});
await sdk.deposits.wait(handle, { for: 'l2' });

// Example: resolve contracts and map an L1 token to its L2 address
const { l1NativeTokenVault } = await sdk.contracts.instances();
const token = await sdk.tokens.resolve('0xYourToken');
console.log(token.l2);
// ANCHOR_END: basic-sdk

// ANCHOR: contract-addresses
const a = await sdk.contracts.addresses();
// ANCHOR_END: contract-addresses
expect(a.bridgehub).toContain("0x");

// ANCHOR: contract-instances
const c = await sdk.contracts.instances();
const bridgehub = c.bridgehub;
// ANCHOR_END: contract-instances
expect(bridgehub.address).toContain("0x");

// ANCHOR: nullifier
const nullifier = await sdk.contracts.l1Nullifier();
// ANCHOR_END: nullifier
expect(nullifier.address).toContain("0x");
});

it('tests the token resource', async () => {
  const sdk = viemSDK;
  const account = me;

// ANCHOR: resolve-token
const token = await sdk.tokens.resolve('0xYourTokenL1...');
/*
{
  kind: 'eth' | 'base' | 'erc20',
  l1: Address,
  l2: Address,
  assetId: Hex,
  originChainId: bigint,
  isChainEthBased: boolean,
  baseTokenAssetId: Hex,
  wethL1: Address,
  wethL2: Address,
}
*/

// ANCHOR_END: resolve-token

// ANCHOR: map-token
const l2Addr = await sdk.tokens.toL2Address('0xTokenL1...');
const l1Addr = await sdk.tokens.toL1Address(l2Addr);
// ANCHOR_END: map-token

// ANCHOR: token-asset-ids
const assetId = await sdk.tokens.assetIdOfL1('0xTokenL1...');
const backL2 = await sdk.tokens.l2TokenFromAssetId(assetId);
// ANCHOR_END: token-asset-ids
});

});
