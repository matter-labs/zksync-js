import { describe, expect, it } from 'bun:test';

// ANCHOR: viem-import
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
// ANCHOR_END: viem-import
// ANCHOR: client-import
import { createViemClient } from '../../../../src/adapters/viem';
// ANCHOR_END: client-import
import type { Address } from 'viem';
import { type ResolvedAddresses as RAddrs } from '../../../../src/adapters/viem/client';
import type { Exact } from "../../core/types";
import { l1Chain, l2Chain } from '../chains';

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

describe('viem client', () => {
// this test will always succeed
// but any errors will be highlighted
it('checks to see if the cleint types are updated', async () => {
    const _clientType: Exact<ResolvedAddresses, RAddrs> = true;
});

it('inits a basic viem adapter and tests the client resource', async () => {
// ANCHOR: init-client
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(process.env.L1_RPC!) });
const l2Wallet = createWalletClient({ chain: l2Chain, account, transport: http(process.env.L2_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });

// Resolve core addresses (cached)
const addrs = await client.ensureAddresses();

// Typed contracts (viem getContract)
const { bridgehub, l1AssetRouter } = await client.contracts();
// ANCHOR_END: init-client
expect(bridgehub.address).toContain('0x');

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
const bhAddress = bh.address; // bh.read.*, bh.write.*, bh.simulate.*
// ANCHOR_END: contracts

// ANCHOR: refresh
client.refresh();
await client.ensureAddresses();
// ANCHOR_END: refresh

// ANCHOR: base
const base = await client.baseToken(6565n);
// ANCHOR_END: base

// ANCHOR: l2-wallet
const w = client.getL2Wallet(); // ensures L2 writes are possible
// ANCHOR_END: l2-wallet
});

});
