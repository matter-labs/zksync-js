import { describe, it } from 'bun:test';

// ANCHOR: viem-basic-imports
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '../../../../src/adapters/viem';
// ANCHOR_END: viem-basic-imports

import { l1Chain, l2Chain } from '../chains';

describe('viem adapter setup', () => {

it('sets up a basic viem adapter', async () => {
// ANCHOR: init-viem-adapter
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(process.env.L1_RPC!) });
const l2Wallet = createWalletClient({ chain: l2Chain, account, transport: http(process.env.L2_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
const sdk = createViemSdk(client);
// ANCHOR_END: init-viem-adapter
});


});
