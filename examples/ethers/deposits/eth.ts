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

import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient } from '../../../src/adapters/ethers/client';
import { createEthersSdk } from '../../../src/adapters/ethers/sdk';
import type { Address } from '../../../src/core/types/primitives';
import { ETH_ADDRESS } from '../../../src/core/constants';

// --- CONFIG ---
// Replace with your own endpoints or load from .env
const L1_RPC = process.env.L1_RPC_URL ?? 'http://localhost:8545';
const L2_RPC = process.env.L2_RPC_URL ?? 'http://localhost:3050';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';

async function main() {
  if (!PRIVATE_KEY) throw new Error('⚠️ Set your PRIVATE_KEY in the .env file');

  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new Wallet(PRIVATE_KEY, l1);

  const me = (await signer.getAddress()) as Address;
  console.log('Using account:', me);

  const l1Balance = await l1.getBalance(me);
  const l2Balance = await l2.getBalance(me);
  console.log('L1 balance:', l1Balance.toString());
  console.log('L2 balance:', l2Balance.toString());

  // --- INIT SDK ---
  const client = createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  // --- DEPOSIT PARAMS ---
  const params = {
    amount: parseEther('0.01'),
    token: ETH_ADDRESS, // ETH Address
    to: me,
    // optional advanced params:
    // l2GasLimit: 300_000n,
    // gasPerPubdata: 800n,
    // operatorTip: 0n,
    // refundRecipient: me,
    // l1TxOverrides: {
    //   gasLimit: 280_000n,
    //   maxFeePerGas: parseEther('0.00000002'), // 20 gwei
    //   maxPriorityFeePerGas: parseEther('0.000000002'), // 2 gwei
    // },
  } as const;

  // --- QUOTE ---
  const quote = await sdk.deposits.quote(params);
  console.log('QUOTE →', quote);

  // --- PREPARE ---
  const plan = await sdk.deposits.prepare(params);
  console.log('PREPARE →', plan);

  // --- CREATE (send tx) ---
  const handle = await sdk.deposits.create(params);
  console.log('CREATE →', handle);

  // --- STATUS ---
  const status = await sdk.deposits.status(handle);
  console.log('STATUS →', status);

  // --- WAIT ---
  console.log('⏳ Waiting for L1 inclusion...');
  const l1Receipt = await sdk.deposits.wait(handle, { for: 'l1' });
  console.log('✅ L1 included at block:', l1Receipt?.blockNumber);

  const statusAfterL1 = await sdk.deposits.status(handle);
  console.log('STATUS (after L1) →', statusAfterL1);

  console.log('⏳ Waiting for L2 execution...');
  const l2Receipt = await sdk.deposits.wait(handle, { for: 'l2' });
  console.log('✅ L2 executed at block:', l2Receipt?.blockNumber);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
