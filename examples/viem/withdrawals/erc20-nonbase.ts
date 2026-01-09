// examples/viem/withdrawals/erc20-nonbase.ts
/**
 * Example: Withdraw a non-base ERC-20 from L2
 *
 * Notes:
 * - Resolve the L2 token with `sdk.helpers.l2TokenAddress(L1_TOKEN)`.
 * - Route: `erc20-nonbase` → ensureRegistered + L2AssetRouter.withdraw(assetId, assetData).
 * - SDK inserts L2 approve(step) to NTV if needed.
 *
 * Flow:
 * 1) Connect, create SDK client.
 * 2) Resolve L2 token from L1 token.
 * 3) Optional: quote/prepare.
 * 4) create → wait L2 → wait ready → tryFinalize → wait finalized.
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

// Replace with a real **L1 ERC-20** you hold
const L1_ERC20 = '0x42E331a2613Fd3a5bc18b47AE3F01e1537fD8873' as Address;

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

  // Resolve L2 token for this L1 token
  const l2Token = await sdk.tokens.toL2Address(L1_ERC20);

  // Read decimals from L2 token (could also read from L1 if mirrored)
  const decimals = (await l2.readContract({
    address: l2Token,
    abi: IERC20ABI,
    functionName: 'decimals',
  })) as number;

  const params = {
    token: l2Token,
    amount: parseUnits('2', decimals),
    to: me,
  } as const;

  // Optional: planning
  // console.log('QUOTE:', await sdk.withdrawals.quote(params));
  // console.log('PREPARE:', await sdk.withdrawals.prepare(params));

  const created = await sdk.withdrawals.create(params);
  console.log('CREATE:', created);

  const l2Receipt = await sdk.withdrawals.wait(created, { for: 'l2' });
  console.log('L2 included tx:', l2Receipt?.transactionHash);

  await sdk.withdrawals.wait(created.l2TxHash, { for: 'ready' });
  console.log('STATUS (ready):', await sdk.withdrawals.status(created.l2TxHash));

  const fin = await sdk.withdrawals.tryFinalize(created.l2TxHash);
  console.log('TRY FINALIZE:', fin);

  const l1Receipt = await sdk.withdrawals.wait(created.l2TxHash, { for: 'finalized' });
  console.log('Finalized. L1 receipt:', l1Receipt?.transactionHash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
