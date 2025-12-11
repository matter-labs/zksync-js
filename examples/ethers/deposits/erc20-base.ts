/**
 * Example: Deposit the base ERC-20 token to an L2 where the base token = ERC-20.
 *
 * Flow:
 * 1. Connect to L1 + L2 RPCs and create an Ethers SDK client.
 * 2. Call `sdk.deposits.quote` to estimate gas/cost.
 * 3. Call `sdk.deposits.prepare` to build the tx plan (includes ERC-20 approvals).
 * 4. Call `sdk.deposits.create` to send the approval(s) and the deposit.
 * 5. Track status with `sdk.deposits.status` and `sdk.deposits.wait`.
 *
 * Note: TOKEN must be the L1 address of the chain’s *base token* (ERC-20),
 * e.g. SOPH on L1 when depositing into a SOPH-based L2.
 */

import { JsonRpcProvider, Wallet, parseUnits, Contract } from 'ethers';
import { createEthersClient } from '../../../src/adapters/ethers/client';
import { createEthersSdk } from '../../../src/adapters/ethers/sdk';
import type { Address } from '../../../src/core/types/primitives';
import { L1_SOPH_TOKEN_ADDRESS } from '../../../src/core/constants';

const L1_RPC = process.env.L1_RPC_URL ?? 'http://localhost:8545';
const L2_RPC = process.env.L2_RPC_URL ?? 'https://zksync-os-testnet-sophon.zksync.dev';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set your PRIVATE_KEY in the .env file');

  // Clients / signer
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new Wallet(PRIVATE_KEY, l1);

  // SDK
  const client = await createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  // Replace with your L1 base-token address (ERC-20)
  // Example below is SOPH L1 address
  const TOKEN = L1_SOPH_TOKEN_ADDRESS;
  const me = (await signer.getAddress()) as Address;

  const l1Token = new Contract(TOKEN, ERC20_ABI, l1);
  // const l2Token = new Contract(TOKEN, ERC20_ABI, l2);

  // --- Balances BEFORE ---
  const l1ETHBalanceBefore = await l1.getBalance(me);
  const l1SOPHBalanceBefore = (await l1Token.balanceOf(me)) as bigint;
  const l2SOPHBalanceBefore = (await l2.getBalance(me)) as bigint;

  // If your base token is 18 decimals; adjust if not.
  const amount = parseUnits('1', 18);

  // Quote
  const quote = await sdk.deposits.quote({ token: TOKEN, to: me, amount });
  console.log('QUOTE:', quote);

  // Prepare (may include an approval step to L1 AssetRouter)
  const prepared = await sdk.deposits.prepare({ token: TOKEN, to: me, amount });
  console.log('PREPARE:', prepared);

  // Create
  const created = await sdk.deposits.create({ token: TOKEN, to: me, amount });
  console.log('CREATE:', created);

  // Status (quick)
  const status = await sdk.deposits.status(created);
  console.log('STATUS:', status);

  // Wait for L1 inclusion
  const l1Receipt = await sdk.deposits.wait(created, { for: 'l1' });
  console.log('L1 included:', l1Receipt?.blockNumber, l1Receipt?.status, l1Receipt?.hash);

  // Wait for L2 execution
  const l2Receipt = await sdk.deposits.wait(created, { for: 'l2' });
  console.log('L2 included:', l2Receipt?.blockNumber, l2Receipt?.status, l2Receipt?.hash);

  const l1ETHBalanceAfter = await l1.getBalance(me);
  const l1SOPHBalanceAfter = (await l1Token.balanceOf(me)) as bigint;
  const l2SOPHBalanceAfter = (await l2.getBalance(me)) as bigint;

  console.log('AFTER:', {
    l1ETHBalanceAfter: l1ETHBalanceAfter.toString(),
    l1SOPHBalanceAfter: l1SOPHBalanceAfter.toString(),
    l2SOPHBalanceAfter: l2SOPHBalanceAfter.toString(),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
