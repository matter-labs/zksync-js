/**
 * Docs-test wallet top-up script.
 *
 * Run once before `bun test docs/snippets` to ensure the test wallet has
 * enough ETH on L2.
 *
 * Env vars:
 *   PRIVATE_KEY  – the test wallet to fund (required)
 *   L1_RPC       – L1 RPC URL (default: http://127.0.0.1:8545)
 *   L2_RPC       – L2 RPC URL (default: http://127.0.0.1:3050)
 *   FUNDER_KEY   – key of the funding account
 *                  (default: well-known ZKsync local-node rich account)
 */

import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../src/adapters/ethers';
import { ETH_ADDRESS } from '../../src/core';

const WELL_KNOWN_FUNDER_KEY =
  '0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FUNDER_KEY = process.env.FUNDER_KEY ?? WELL_KNOWN_FUNDER_KEY;
const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const L2_RPC = process.env.L2_RPC ?? 'http://127.0.0.1:3050';

const TOP_UP_AMOUNT = parseEther('10');

if (!PRIVATE_KEY) {
  console.warn('[setup] PRIVATE_KEY not set — skipping wallet top-up.');
  process.exit(0);
}

const testAddress = new Wallet(PRIVATE_KEY).address;

const l1 = new JsonRpcProvider(L1_RPC);
const l2 = new JsonRpcProvider(L2_RPC);
const signer = new Wallet(FUNDER_KEY, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);

console.log(`[setup] Depositing 10 ETH to ${testAddress} on L2...`);
const handle = await sdk.deposits.create({
  token: ETH_ADDRESS,
  amount: TOP_UP_AMOUNT,
  to: testAddress as `0x${string}`,
});

await sdk.deposits.wait(handle, { for: 'l2' });
console.log('[setup] Done.');
