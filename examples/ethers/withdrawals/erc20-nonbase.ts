// examples/ethers/withdrawals/erc20-nonbase.ts
/**
 * Example: Withdraw a non-base ERC-20 from L2
 *
 * Notes:
 * - Pass the L1 token address to `sdk.helpers.l2TokenAddress` to discover its L2 counterpart.
 * - Route: `erc20-nonbase` → NTV + L2AssetRouter.withdraw(assetId, assetData).
 * - SDK will add an L2 approval step (spender = L2NativeTokenVault) if needed.
 *
 * Flow:
 * 1) Connect to L1 + L2 RPCs and create Ethers SDK client.
 * 2) Resolve the L2 token address using `sdk.helpers.l2TokenAddress(L1_TOKEN)`.
 * 3) Inspect balances/symbol/decimals.
 * 4) Call `sdk.withdrawals.quote` or `prepare` (optional).
 * 5) Call `sdk.withdrawals.create` (approve first if needed, then withdraw).
 * 6) Wait for L2 inclusion → wait for readiness → tryFinalize → wait for finalized.
 */

import { JsonRpcProvider, Wallet, parseUnits, Contract } from 'ethers';
import { createEthersClient } from '../../../src/adapters/ethers/client';
import { createEthersSdk } from '../../../src/adapters/ethers/sdk';
import type { Address } from '../../../src/core/types/primitives';
import { IERC20ABI } from '../../../src/core/internal/abi-registry';

const L1_RPC = 'http://localhost:8545';
const L2_RPC = 'http://localhost:3050';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Replace with a real **L1 ERC-20 token address** you hold
const L1_ERC20_TOKEN = '0x42E331a2613Fd3a5bc18b47AE3F01e1537fD8873' as Address;

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set your PRIVATE_KEY in the environment');

  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new Wallet(PRIVATE_KEY, l1);

  const client = await createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  const me = (await signer.getAddress()) as Address;

  // Discover the corresponding L2 token for this L1 token
  const l2Token = await sdk.helpers.l2TokenAddress(L1_ERC20_TOKEN);

  const erc20L1 = new Contract(L1_ERC20_TOKEN, IERC20ABI, l1);
  const erc20L2 = new Contract(l2Token, IERC20ABI, l2);
  const [sym, dec] = await Promise.all([erc20L2.symbol(), erc20L2.decimals()]);

  // Balances before
  const [balL1Before, balL2Before] = await Promise.all([
    erc20L1.balanceOf(me),
    erc20L2.balanceOf(me),
  ]);
  console.log(`[${sym}] before: L1=${balL1Before}  L2=${balL2Before}`);

  const params = {
    token: l2Token,
    amount: parseUnits('25', dec),
    to: me,
  } as const;

  // Optional dry-run / planning
  // console.log('QUOTE:', await sdk.withdrawals.quote(params));
  // console.log('PREPARE:', await sdk.withdrawals.prepare(params));

  // Execute withdrawal (approve first if needed, then burn & message)
  const created = await sdk.withdrawals.create(params);
  console.log('CREATE:', created);

  // Wait for L2 inclusion
  const l2Receipt = await sdk.withdrawals.wait(created, { for: 'l2' });
  console.log(
    'L2 included:',
    l2Receipt?.blockNumber,
    l2Receipt?.status,
    l2Receipt?.hash ?? l2Receipt?.hash,
  );

  console.log('STATUS (ready):', await sdk.withdrawals.status(created.l2TxHash));

  // Wait until the withdrawal is ready to finalize
  await sdk.withdrawals.wait(created.l2TxHash, { for: 'ready' });

  // Finalize on L1 (if not already finalized)
  const fin = await sdk.withdrawals.tryFinalize(created.l2TxHash);
  if (!fin.ok) {
    console.error('FINALIZE failed:', fin.error);
    return;
  }
  console.log(
    'FINALIZE status:',
    fin.value.status,
    fin.value.receipt?.hash ?? '(already finalized)',
  );

  // Wait for finalization confirmation
  const l1Receipt = await sdk.withdrawals.wait(created.l2TxHash, { for: 'finalized' });
  if (l1Receipt) {
    console.log('L1 finalize receipt:', l1Receipt.hash);
  } else {
    console.log('Finalized (no local L1 receipt, possibly finalized by another actor).');
  }

  // Balances after
  const [balL1After, balL2After] = await Promise.all([
    erc20L1.balanceOf(me),
    erc20L2.balanceOf(me),
  ]);
  console.log(`[${sym}] after:  L1=${balL1After}  L2=${balL2After}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
