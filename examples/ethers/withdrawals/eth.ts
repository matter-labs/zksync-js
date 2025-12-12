// examples/ethers/withdrawals/eth.ts
/**
 * Example: Withdraw ETH token from an ETH-BASED L2
 *
 * Notes:
 * - Use the L2 base-token system address (0x...800A) as `token` or `ETH_ADDRESS`.
 * - Route: `base` → L2 BaseTokenSystem.withdraw(to).
 *
 * Flow:
 * 1) Connect to L1 + L2 RPCs and create Ethers SDK client.
 * 2) Call `sdk.withdrawals.quote` to estimate.
 * 3) Call `sdk.withdrawals.prepare` to build the plan.
 * 4) Call `sdk.withdrawals.create` to send the L2 withdraw.
 * 5) Track with `sdk.withdrawals.status` and `sdk.withdrawals.wait`:
 *      - wait(..., { for: 'l2' })       → L2 inclusion
 *      - wait(..., { for: 'ready' })    → ready to finalize
 *      - tryFinalize(...)                → submit L1 finalize (if needed)
 *      - wait(..., { for: 'finalized' })→ finalized on L1
 */

import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient } from '../../../src/adapters/ethers/client';
import { createEthersSdk } from '../../../src/adapters/ethers/sdk';
import type { Address } from '../../../src/core/types/primitives';
import { ETH_ADDRESS } from '../../../src/core/constants';

const L1_RPC = process.env.L1_RPC_URL ?? 'http://localhost:8545';
const L2_RPC = process.env.L2_RPC_URL ?? 'http://localhost:3050';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set your PRIVATE_KEY in the environment');

  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new Wallet(PRIVATE_KEY, l1);

  const client = await createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  const me = (await signer.getAddress()) as Address;

  const params = {
    token: ETH_ADDRESS, // ETH token on this chain
    amount: parseEther('.0001'),
    to: me,
    // l2TxOverrides: {
    //   gasLimit: 400_000n,
    //   maxFeePerGas: parseEther('0.00000002'),
    //   maxPriorityFeePerGas: parseEther('0.000000002'),
    // },
  } as const;

  const quote = await sdk.withdrawals.quote(params);
  console.log('QUOTE:', quote);

  const prepared = await sdk.withdrawals.prepare(params);
  console.log('PREPARE:', prepared);

  const created = await sdk.withdrawals.create(params);
  console.log('CREATE:', created);

  console.log('STATUS (initial):', await sdk.withdrawals.status(created));

  // Wait for L2 inclusion
  const l2Receipt = await sdk.withdrawals.wait(created, { for: 'l2' });
  console.log('L2 included:', l2Receipt?.hash);

  // Wait until ready to finalize
  await sdk.withdrawals.wait(created, { for: 'ready' });
  console.log('STATUS (ready):', await sdk.withdrawals.status(created));

  // Try to finalize (no-op if already finalized by someone else)
  const fin = await sdk.withdrawals.tryFinalize(created.l2TxHash);
  console.log('TRY FINALIZE:', fin);

  // Wait for finalization
  const l1Receipt = await sdk.withdrawals.wait(created.l2TxHash, { for: 'finalized' });
  console.log('Finalized. L1 receipt:', l1Receipt?.hash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
