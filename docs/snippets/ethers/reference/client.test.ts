import { describe, expect, it } from 'bun:test';

// ANCHOR: ethers-import
import { JsonRpcProvider, Wallet } from 'ethers';
// ANCHOR_END: ethers-import
// ANCHOR: client-import
import { createEthersClient } from '../../../../src/adapters/ethers';
// ANCHOR_END: client-import
import type { Address } from 'viem';
import { type ResolvedAddresses as RAddrs } from '../../../../src/adapters/ethers/client';
import type { Exact } from "../../core/types";

// ANCHOR: resolved-type
type ResolvedAddresses = {
  bridgehub: Address;
  l1AssetRouter: Address;
  l1Nullifier: Address;
  l1NativeTokenVault: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  l2BaseTokenSystem: Address;
};
// ANCHOR_END: resolved-type

describe('ethers client', () => {
// this test will always succeed
// but any errors will be highlighted
it('checks to see if the cleint types are updated', async () => {
    const _clientType: Exact<ResolvedAddresses, RAddrs> = true;
});

it('inits a basic ethers adapter and tests the client', async () => {
// ANCHOR: init-client
const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2 = new JsonRpcProvider(process.env.L2_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });

// Resolve core addresses (cached)
const addrs = await client.ensureAddresses();

// Connected contracts
const { bridgehub, l1AssetRouter } = await client.contracts();
// ANCHOR_END: init-client
expect(bridgehub.target).toContain('0x');

// ANCHOR: ensureAddresses
const a = await client.ensureAddresses();
/*
{
  bridgehub, l1AssetRouter, l1Nullifier, l1NativeTokenVault,
  l2AssetRouter, l2NativeTokenVault, l2BaseTokenSystem
}
*/
// ANCHOR_END: ensureAddresses

// ANCHOR: contracts
const c = await client.contracts();
const bh = c.bridgehub;
await bh.getAddress();
// ANCHOR_END: contracts

// ANCHOR: refresh
client.refresh();
await client.ensureAddresses();
// ANCHOR_END: refresh

// ANCHOR: base
const base = await client.baseToken(6565n);
// ANCHOR_END: base


});

});
