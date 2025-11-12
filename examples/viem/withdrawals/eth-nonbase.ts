// examples/viem/withdrawals/eth-nonbase.ts
/**
 * Example: Withdraw ETH from a non-ETH base L2
 *
 * Notes:
 * - Use the ETH sentinel (SDK constant `ETH_ADDRESS`) as `token`.
 * - Route: `eth-nonbase` → NTV + L2AssetRouter.withdraw(assetId, assetData).
 * - SDK inserts L2 approval step for the L2-ETH representation if needed.
 *
 * Flow:
 * 1) Connect, create Viem SDK client.
 * 2) Optional: quote/prepare.
 * 3) create → wait L2 → wait ready → tryFinalize → wait finalized.
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

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Example L2-ETH token on Sophon (replace with the correct one for your chain)
const SOPH_ETH = '0x29bF0eCe24D64De5E2034865A339AbBf16FdcAc0' as Address;

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
    token: SOPH_ETH, // ETH address on non-ETH base chains
    amount: parseEther('0.02'),
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
