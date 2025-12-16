/**
 * Example: Deposit an ERC-20 token to an L2 where the base token ≠ this ERC-20
 *
 * Flow:
 * 1. Connect to L1 + L2 RPCs and create an SDK client (Ethers or Viem).
 * 2. Call `sdk.deposits.quote` to estimate gas/cost.
 * 3. Call `sdk.deposits.prepare` to build the tx plan (approvals + bridge call).
 * 4. Call `sdk.deposits.create` to send the approval(s) and the bridge tx.
 * 5. Track status with `sdk.deposits.status` and `sdk.deposits.wait`
 *    (`{ for: 'l1' }` waits for L1 inclusion, `{ for: 'l2' }` waits for L2 exec).
 *
 * Use this when:
 * - You’re depositing a standard ERC-20 token.
 * - The target L2’s base token is something else (e.g. you’re sending USDC to an ETH-based chain).
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

const L1_RPC = process.env.L1_RPC_URL ?? 'http://localhost:8545';
const L2_RPC = process.env.L2_RPC_URL ?? 'http://localhost:3050';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';

async function main() {
  if (!PRIVATE_KEY || PRIVATE_KEY.length !== 66) {
    throw new Error('Set a 0x-prefixed 32-byte PRIVATE_KEY in .env');
  }

  // Pick an ERC-20 on L1 (example uses a dev/mocked token)
  // Make sure you hold some of this token on L1 before running!
  // Example: sepolia test token (TEST)
  // https://sepolia.etherscan.io/token/0x42E331a2613Fd3a5bc18b47AE3F01e1537fD8873
  const TOKEN = (process.env.DEPOSIT_TOKEN ??
    '0x42E331a2613Fd3a5bc18b47AE3F01e1537fD8873') as Address;

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2 = createPublicClient({ transport: http(L2_RPC) });

  const l1Wallet: WalletClient<Transport, Chain, Account> = createWalletClient({
    account,
    transport: http(L1_RPC),
  });

  // Init SDK
  const client = createViemClient({ l1, l2, l1Wallet });
  const sdk = createViemSdk(client);

  const me = account.address as Address;

  // Read decimals to build the amount
  const decimals = (await l1.readContract({
    address: TOKEN,
    abi: IERC20ABI,
    functionName: 'decimals',
  })) as number;

  const amount = parseUnits('2', decimals); // deposit 2 tokens

  // QUOTE → no sends
  const quote = await sdk.deposits.quote({ token: TOKEN, to: me, amount });
  console.log('QUOTE →', quote);

  // PREPARE → route + steps only
  const prepared = await sdk.deposits.prepare({ token: TOKEN, to: me, amount });
  console.log('PREPARE →', prepared);

  // CREATE → sends approval(s) if needed + bridge step
  const created = await sdk.deposits.create({ token: TOKEN, to: me, amount });
  console.log('CREATE →', created);

  // STATUS (quick)
  console.log('STATUS →', await sdk.deposits.status(created));

  // WAIT L1 inclusion
  console.log('⏳ Waiting for L1 inclusion…');
  const l1Receipt = await sdk.deposits.wait(created, { for: 'l1' });
  console.log('✅ L1 included at block:', l1Receipt?.blockNumber);

  // WAIT L2 execution
  console.log('⏳ Waiting for L2 execution…');
  const l2Receipt = await sdk.deposits.wait(created, { for: 'l2' });
  console.log('✅ L2 executed at block:', l2Receipt?.blockNumber);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
