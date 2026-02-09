import { beforeAll, describe, expect, it } from 'bun:test';

// ANCHOR: imports
import { JsonRpcProvider, Wallet } from 'ethers';
import { createEthersClient, createEthersSdk} from '../../../../src/adapters/ethers';
// ANCHOR_END: imports
import type { EthersSdk } from '../../../../src/adapters/ethers';

describe('ethers contracts', () => {

let ethersSdk: EthersSdk;

beforeAll(async() => {
// ANCHOR: init-sdk
const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2 = new JsonRpcProvider(process.env.L2_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);
// sdk.contracts → ContractsResource
// ANCHOR_END: init-sdk

ethersSdk = sdk;
})

it('gets the native token vault contract', async () => {
const sdk = ethersSdk;

// ANCHOR: ntv
const addresses = await sdk.contracts.addresses();
const { l1NativeTokenVault, l2AssetRouter } = await sdk.contracts.instances();

const ntv = await sdk.contracts.l1NativeTokenVault();
// ANCHOR_END: ntv
expect(ntv.target).toContain("0x");
expect(l1NativeTokenVault.target).toContain("0x");
expect(l2AssetRouter.target).toContain("0x");
expect(addresses.bridgehub).toContain("0x");
});

it('gets contract addresses from the sdk', async () => {
const sdk = ethersSdk;

// ANCHOR: addresses
const a = await sdk.contracts.addresses();
/*
{
  bridgehub,
  l1AssetRouter,
  l1Nullifier,
  l1NativeTokenVault,
  l2AssetRouter,
  l2NativeTokenVault,
  l2BaseTokenSystem
}
*/
// ANCHOR_END: addresses
});

it('gets contract instances from the sdk', async () => {
const sdk = ethersSdk;

// ANCHOR: instances
const c = await sdk.contracts.instances();
/*
{
  bridgehub,
  l1AssetRouter,
  l1Nullifier,
  l1NativeTokenVault,
  l2AssetRouter,
  l2NativeTokenVault,
  l2BaseTokenSystem
}
*/
// ANCHOR_END: instances

});

it('gets the l2 asset router contract from the sdk', async () => {
const sdk = ethersSdk;

// ANCHOR: router
const router = await sdk.contracts.l2AssetRouter();
// ANCHOR_END: router
});

});
