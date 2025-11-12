// examples/ethers/withdrawals/eth-nonbase.ts
/**
 * Example: Withdraw ETH from an L2 whose base token is NOT ETH
 *
 * Notes:
 * - Use the ETH sentinel (0xEeeee… or your SDK’s ETH constant) as `token`.
 * - Route: `eth-nonbase` → NTV + L2AssetRouter.withdraw(assetId, assetData).
 * - SDK will add an L2 approval step for the L2-ETH token if needed.
 *
 * Flow:
 * 1) Connect to L1 + L2 RPCs and create Ethers SDK client.
 * 2) Call `sdk.withdrawals.quote`.
 * 3) Call `sdk.withdrawals.prepare`.
 * 4) Call `sdk.withdrawals.create` (sends approve on L2 if needed, then withdraw).
 * 5) Wait for L2 inclusion → wait for readiness → tryFinalize → wait for finalized.
 */

import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient } from '../../../src/adapters/ethers/client';
import { createEthersSdk } from '../../../src/adapters/ethers/sdk';
import type { Address } from '../../../src/core/types/primitives';

const L1_RPC = 'http://localhost:8545';
const L2_RPC = 'http://localhost:3050';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Example L2-ETH token on Sophon (replace with the correct one for your chain)
const SOPH_ETH = '0x29bF0eCe24D64De5E2034865A339AbBf16FdcAc0' as Address;

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set your PRIVATE_KEY in the environment');

  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new Wallet(PRIVATE_KEY, l1);

  const client = await createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  const me = (await signer.getAddress()) as Address;

  const params = {
    token: SOPH_ETH,
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

  // L2 inclusion
  const l2Receipt = await sdk.withdrawals.wait(created, { for: 'l2' });
  console.log('L2 included:', l2Receipt?.hash);

  // Ready to finalize
  await sdk.withdrawals.wait(created, { for: 'ready' });
  console.log('STATUS (ready):', await sdk.withdrawals.status(created));

  // Finalize on L1 (if needed)
  const fin = await sdk.withdrawals.tryFinalize(created.l2TxHash);
  console.log('TRY FINALIZE:', fin);

  // Finalized
  const l1Receipt = await sdk.withdrawals.wait(created.l2TxHash, { for: 'finalized' });
  console.log('Finalized. L1 receipt:', l1Receipt?.hash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
