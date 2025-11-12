// examples/viem/withdrawals/eth.ts
/**
 * Example: Withdraw ETH token from an ETH-BASED L2
 *
 * Notes:
 * - Use the L2 base-token system address (0x...800A) as `token` or `ETH_ADDRESS`.
 * - Route: `eth-base` → L2 BaseTokenSystem.withdraw(to).
 *
 * Flow:
 * 1) Connect to L1 + L2 RPCs and create Viem SDK client.
 * 2) Call `sdk.withdrawals.quote` to estimate.
 * 3) Call `sdk.withdrawals.prepare` to build the plan.
 * 4) Call `sdk.withdrawals.create` to send the L2 withdraw.
 * 5) Track with `sdk.withdrawals.status` and `sdk.withdrawals.wait`:
 *      - wait(..., { for: 'l2' })       → L2 inclusion
 *      - wait(..., { for: 'ready' })    → ready to finalize
 *      - tryFinalize(...)                → submit L1 finalize (if needed)
 *      - wait(..., { for: 'finalized' })→ finalized on L1
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Account,
  type Chain,
  type Transport,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createViemClient } from '../../../src/adapters/viem/client';
import { createViemSdk } from '../../../src/adapters/viem/sdk';
import type { Address } from '../../../src/core/types/primitives';
import { ETH_ADDRESS } from '../../../src/core/constants';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set your PRIVATE_KEY in the environment');

  // Clients
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2 = createPublicClient({ transport: http(L2_RPC) });
  const l1Wallet: WalletClient<Transport, Chain, Account> = createWalletClient({
    account,
    transport: http(L1_RPC),
  });
  // Need to provide an L2 wallet client for sending L2 withdraw tx
  const l2Wallet = createWalletClient<Transport, Chain, Account>({
    account,
    transport: http(L2_RPC),
  });

  const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
  const sdk = createViemSdk(client);

  const me = account.address as Address;

  const params = {
    token: ETH_ADDRESS, // ETH Address
    amount: parseEther('0.0001'),
    to: me,
  } as const;

  const quote = await sdk.withdrawals.quote(params);
  console.log('QUOTE:', quote);

  const prepared = await sdk.withdrawals.prepare(params);
  console.log('PREPARE:', prepared);

  const created = await sdk.withdrawals.create(params);
  console.log('CREATE:', created);

  console.log('STATUS (initial):', await sdk.withdrawals.status(created));

  const l2Receipt = await sdk.withdrawals.wait(created, { for: 'l2' });
  console.log('L2 included tx:', l2Receipt?.transactionHash);

  await sdk.withdrawals.wait(created, { for: 'ready' });
  console.log('STATUS (ready):', await sdk.withdrawals.status(created));

  const fin = await sdk.withdrawals.tryFinalize(created.l2TxHash);
  console.log('TRY FINALIZE:', fin);

  const l1Receipt = await sdk.withdrawals.wait(created.l2TxHash, { for: 'finalized' });
  console.log('Finalized. L1 receipt:', l1Receipt?.transactionHash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
