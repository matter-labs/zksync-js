import { describe, expect, it } from 'bun:test';

// ANCHOR: imports
import { createViemClient, createViemSdk } from '../../../../src/adapters/viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http } from 'viem';
// ANCHOR_END: imports
import { l1Chain, l2Chain } from '../chains';

describe('viem contracts', () => {

it('tests the viem contracts resource', async () => {
// ANCHOR: init-sdk
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(process.env.L1_RPC!) });
const l2Wallet = createWalletClient({ chain: l2Chain, account, transport: http(process.env.L2_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
const sdk = createViemSdk(client);
// sdk.contracts → ContractsResource
// ANCHOR_END: init-sdk

// ANCHOR: ntv
const addresses = await sdk.contracts.addresses();
const { l1NativeTokenVault, l2AssetRouter } = await sdk.contracts.instances();

const ntv = await sdk.contracts.l1NativeTokenVault();
// ANCHOR_END: ntv
expect(ntv.address).toContain("0x");
expect(l1NativeTokenVault.address).toContain("0x");
expect(l2AssetRouter.address).toContain("0x");
expect(addresses.bridgehub).toContain("0x");

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

// ANCHOR: router
const router = await sdk.contracts.l2AssetRouter();
// ANCHOR_END: router

});

});
