// examples/viem/withdrawals/base.ts
/**
 * Example: Withdraw the BASE token from a non-ETH base L2
 *
 * Notes:
 * - Base token is always addressed via the L2 base-token system alias (0x...800A).
 * - The SDK detects the chain’s base token (ETH or not) and picks the right path.
 *
 * Flow:
 * 1) Connect to L1 + L2 RPCs and create Viem SDK client.
 * 2) Call `quote` → `prepare` (optional).
 * 3) `create` → wait L2 → wait ready → tryFinalize → wait finalized.
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
import { L2_BASE_TOKEN_ADDRESS } from '../../../src/core/constants';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set your PRIVATE_KEY in the environment');

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
    token: L2_BASE_TOKEN_ADDRESS, // BASE token (e.g., SOPH) via 0x...800A
    amount: parseEther('1'),
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
