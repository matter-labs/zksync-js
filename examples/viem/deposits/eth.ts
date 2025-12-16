/**
 * Example: Deposit ETH into an L2
 *
 * The SDK automatically selects the correct route:
 * - If the target L2 base token is ETH → uses eth-base route.
 * - If the target L2 base token ≠ ETH → uses eth-nonbase route.
 *
 * Flow:
 * 1. Connect to L1 + L2 RPCs and create the SDK client.
 * 2. Call `sdk.deposits.quote` to estimate cost.
 * 3. Call `sdk.deposits.prepare` to build the tx plan.
 * 4. Call `sdk.deposits.create` to send the deposit.
 * 5. Track with `sdk.deposits.status` and `sdk.deposits.wait`.
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

// --- CONFIG ---
// Use env if available, otherwise fall back to local dev defaults.
const L1_RPC = process.env.L1_RPC_URL ?? 'http://localhost:8545';
const L2_RPC = process.env.L2_RPC_URL ?? 'http://localhost:3050';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';

async function main() {
  if (!PRIVATE_KEY || PRIVATE_KEY.length !== 66) {
    throw new Error('⚠️ Set a 0x-prefixed 32-byte PRIVATE_KEY in your .env');
  }

  // --- Clients (Viem) ---
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2 = createPublicClient({ transport: http(L2_RPC) });

  const l1Wallet: WalletClient<Transport, Chain, Account> = createWalletClient({
    account,
    transport: http(L1_RPC),
  });

  // Show balances for sanity
  const [balL1, balL2] = await Promise.all([
    l1.getBalance({ address: account.address }),
    l2.getBalance({ address: account.address }),
  ]);
  console.log('Using account:', account.address);
  console.log('L1 balance:', balL1.toString());
  console.log('L2 balance:', balL2.toString());

  // --- Init SDK ---
  const client = createViemClient({ l1, l2, l1Wallet });
  const sdk = createViemSdk(client);

  // --- Deposit params ---
  const me = account.address as Address;
  const params = {
    amount: parseEther('0.001'),
    token: ETH_ADDRESS,
    to: me,
    // optional:
    // l2GasLimit: 300_000n,
    // gasPerPubdata: 800n,
    // operatorTip: 0n,
    // refundRecipient: me,
  } as const;

  // QUOTE
  const quote = await sdk.deposits.quote(params);
  console.log('QUOTE →', quote);

  // PREPARE (no txs sent)
  const plan = await sdk.deposits.prepare(params);
  console.log('PREPARE →', plan);

  // CREATE (send deposit)
  const handle = await sdk.deposits.create(params);
  console.log('CREATE →', handle);

  // STATUS
  const status = await sdk.deposits.status(handle);
  console.log('STATUS →', status);

  // WAIT: L1 inclusion
  console.log('⏳ Waiting for L1 inclusion...');
  const l1Receipt = await sdk.deposits.wait(handle, { for: 'l1' });
  console.log('✅ L1 included at block:', l1Receipt?.blockNumber);

  const statusAfterL1 = await sdk.deposits.status(handle);
  console.log('STATUS (after L1) →', statusAfterL1);

  // WAIT: L2 execution
  console.log('⏳ Waiting for L2 execution...');
  const l2Receipt = await sdk.deposits.wait(handle, { for: 'l2' });
  console.log('✅ L2 executed at block:', l2Receipt?.blockNumber);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
