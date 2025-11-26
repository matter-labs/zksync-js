// examples/viem/deposits/erc20-base.ts

/**
 * Example: Deposit the BASE ERC-20 into an L2 where the base token is not ETH.
 *
 * Notes:
 * - The SDK will pick the `erc20-base` route automatically when `token` equals the target L2's base token.
 * - The SDK will add an approval step (spender = L1AssetRouter) if needed for `mintValue`.
 *
 * Flow:
 * 1. Connect to L1 + L2 RPCs and create the SDK client.
 * 2. (Optional) Read ERC-20 `decimals` to build the amount with `parseUnits`.
 * 3. Call `sdk.deposits.quote` to estimate cost (includes mintValue parts).
 * 4. Call `sdk.deposits.prepare` to build the full plan (approval + bridge step).
 * 5. Call `sdk.deposits.create` to send all required txs (approval first, then bridge).
 * 6. Track with `sdk.deposits.status` and `sdk.deposits.wait` (L1 then L2).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Account,
  type Chain,
  type Transport,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createViemClient } from '../../../src/adapters/viem/client';
import { createViemSdk } from '../../../src/adapters/viem/sdk';
import type { Address } from '../../../src/core/types/primitives';
import { IERC20ABI } from '../../../src/core/abi';
import { L1_SOPH_TOKEN_ADDRESS } from '../../../src/core/constants';

// ---- configure your RPCs & key ----
const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// IMPORTANT: This must be the base token contract on L1 for your target L2 (NOT ETH).
// Replace with your L1 base-token address (ERC-20)
// Example below is SOPH L1 address
// https://sepolia.etherscan.io/token/0xa9544a49d4aEa4c8E074431c89C79fA9592049d8
const TOKEN = L1_SOPH_TOKEN_ADDRESS;

async function main() {
  if (!PRIVATE_KEY || PRIVATE_KEY.length !== 66) {
    throw new Error('Set a 0x-prefixed 32-byte PRIVATE_KEY in your environment.');
  }

  // --- viem clients & wallet ---
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2 = createPublicClient({ transport: http(L2_RPC) });
  const l1Wallet: WalletClient<Transport, Chain, Account> = createWalletClient({
    account,
    transport: http(L1_RPC),
  });

  // --- SDK ---
  const client = createViemClient({ l1, l2, l1Wallet });
  const sdk = createViemSdk(client);

  // --- read decimals to build a friendly amount ---
  const decimals = (await l1.readContract({
    address: TOKEN,
    abi: IERC20ABI,
    functionName: 'decimals',
  })) as number;

  const me = account.address as Address;
  const depositAmount = parseUnits('250', decimals); // deposit 250 units of base token

  // --- Quote (dry run) ---
  const quote = await sdk.deposits.quote({
    token: TOKEN,
    to: me, // L2 recipient (defaults to sender)
    amount: depositAmount,
  });
  console.log('QUOTE:', quote);

  // --- Prepare (route + steps, no sends) ---
  const prepared = await sdk.deposits.prepare({
    token: TOKEN,
    to: me,
    amount: depositAmount,
  });
  console.log('PREPARE:', prepared);

  // --- Create (send approval if needed, then bridge) ---
  const created = await sdk.deposits.create({
    token: TOKEN,
    to: me,
    amount: depositAmount,
  });
  console.log('CREATE:', created);

  // --- Immediate status ---
  const status0 = await sdk.deposits.status(created);
  console.log('STATUS (initial):', status0);

  // --- Wait for L1 inclusion ---
  const l1Receipt = await sdk.deposits.wait(created, { for: 'l1' });
  console.log(
    'L1 included: block=',
    l1Receipt?.blockNumber,
    'status=',
    l1Receipt?.status,
    'hash=',
    l1Receipt?.transactionHash,
  );

  // --- Status again ---
  const status1 = await sdk.deposits.status(created);
  console.log('STATUS (post-L1):', status1);

  // --- Wait for L2 execution ---
  const l2Receipt = await sdk.deposits.wait(created, { for: 'l2' });
  console.log(
    'L2 included: block=',
    l2Receipt?.blockNumber,
    'status=',
    l2Receipt?.status,
    'hash=',
    l2Receipt?.transactionHash,
  );

  const status2 = await sdk.deposits.status(created);
  console.log('STATUS (final):', status2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
