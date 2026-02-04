import { beforeAll, describe, expect, it } from 'bun:test';

// ANCHOR: ethers-import
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
// ANCHOR_END: ethers-import
// ANCHOR: eth-import
import { ETH_ADDRESS } from '../../../../src/core';
// ANCHOR_END: eth-import
// ANCHOR: sdk-import
import { createEthersClient, createEthersSdk } from '../../../../src/adapters/ethers';
// ANCHOR_END: sdk-import
import type { EthersSdk } from '../../../../src/adapters/ethers';

describe('ethers sdk', () => {

let ethersSDK: EthersSdk;
let me: Wallet;

beforeAll(() => {
// ANCHOR: init-sdk
const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2 = new JsonRpcProvider(process.env.L2_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);
// ANCHOR_END: init-sdk
ethersSDK = sdk;
me = signer;

// ANCHOR: erc-20-address
const tokenAddress = '0xTokenL1...';
// ANCHOR_END: erc-20-address
})

it('tests the ethers sdk', async () => {
  const sdk = ethersSDK;
  const signer = me;
  const tokenAddress = ETH_ADDRESS;
// ANCHOR: basic-sdk
// Example: deposit 0.05 ETH L1 → L2 and wait for L2 execution
const handle = await sdk.deposits.create({
  token: ETH_ADDRESS, // 0x…00 sentinel for ETH supported
  amount: parseEther('0.05'),
  to: await signer.getAddress() as `0x${string}`,
});

await sdk.deposits.wait(handle, { for: 'l2' });

// Example: resolve core contracts
const { l1NativeTokenVault } = await sdk.contracts.instances();

// Example: map a token L1 → L2
const token = await sdk.tokens.resolve(tokenAddress);
console.log(token.l2);
// ANCHOR_END: basic-sdk

// ANCHOR: contract-addresses
const a = await sdk.contracts.addresses();
// ANCHOR_END: contract-addresses
expect(a.bridgehub).toContain("0x");

// ANCHOR: contract-instances
const c = await sdk.contracts.instances();
// ANCHOR_END: contract-instances
expect(c.bridgehub.target).toContain("0x");

// ANCHOR: nullifier
const nullifier = await sdk.contracts.l1Nullifier();
// ANCHOR_END: nullifier
expect(nullifier.target).toContain("0x");
});

it('tests the token resource', async () => {
  const sdk = ethersSDK;
  const signer = me;
  const tokenAddress = ETH_ADDRESS;

// ANCHOR: resolve-token
const token = await sdk.tokens.resolve(tokenAddress);
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
const l2Addr = await sdk.tokens.toL2Address(tokenAddress);
const l1Addr = await sdk.tokens.toL1Address(l2Addr);
// ANCHOR_END: map-token

// ANCHOR: token-asset-ids
const assetId = await sdk.tokens.assetIdOfL1(tokenAddress);
const backL2 = await sdk.tokens.l2TokenFromAssetId(assetId);
// ANCHOR_END: token-asset-ids
});

});
