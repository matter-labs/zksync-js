import { beforeAll, describe, expect, it } from 'bun:test';

// ANCHOR: imports
import { createViemClient, createViemSdk } from '../../../../src/adapters/viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
// ANCHOR_END: imports
// ANCHOR: eth-import
import { ETH_ADDRESS } from '../../../../src/core/constants';
// ANCHOR_END: eth-import
import type { ViemSdk } from '../../../../src/adapters/viem';
import { l1Chain, l2Chain } from '../chains';
import type { Account } from 'viem';

describe('viem withdrawals', () => {

  let viemSDK: ViemSdk;
  let me: Account;

beforeAll(() => {
// ANCHOR: init-sdk
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(process.env.L1_RPC!) });
const l2Wallet = createWalletClient({ chain: l2Chain, account, transport: http(process.env.L2_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
const sdk = createViemSdk(client);
// sdk.withdrawals → WithdrawalsResource
// ANCHOR_END: init-sdk
  viemSDK = sdk;
  me = account;
})

it('creates a withdrawal', async () => {
const account = me;
const sdk = viemSDK;
// ANCHOR: create-withdrawal
const handle = await sdk.withdrawals.create({
  token: ETH_ADDRESS, // ETH sentinel supported
  amount: parseEther('0.1'),
  to: account.address, // L1 recipient
});

// 1) L2 inclusion (adds l2ToL1Logs if available)
await sdk.withdrawals.wait(handle, { for: 'l2' });

// 2) Wait until finalizable (no side effects)
await sdk.withdrawals.wait(handle, { for: 'ready', pollMs: 6000 });

// 3) Finalize on L1 (no-op if already finalized)
const { status, receipt: l1Receipt } = await sdk.withdrawals.finalize(handle.l2TxHash);
// ANCHOR_END: create-withdrawal
});

it('creates a withdrawal 2', async () => {
const account = me;
const sdk = viemSDK;
const token = ETH_ADDRESS;
const amount = parseEther('0.01');
const to = account.address;

// ANCHOR: quote
const q = await sdk.withdrawals.quote({ token, amount, to });
/*
{
  route: "base" | "erc20-nonbase",
  summary: {
    route,
    approvalsNeeded: [{ token, spender, amount }],
    amounts: {
      transfer: { token, amount }
    },
    fees: {
      token,
      maxTotal,
      mintValue,
      l2: { gasLimit, maxFeePerGas, maxPriorityFeePerGas, total }
    }
  }
}
*/
// ANCHOR_END: quote
expect(q.route).toEqual("base");

// ANCHOR: plan
const plan = await sdk.withdrawals.prepare({ token, amount, to });
/*
{
  route,
  summary: WithdrawQuote,
  steps: [
    { key, kind, tx: TransactionRequest },
    // …
  ]
}
*/
// ANCHOR_END: plan
expect(plan.route).toEqual("base");

// ANCHOR: handle
const handle = await sdk.withdrawals.create({ token, amount, to });
/*
{
  kind: "withdrawal",
  l2TxHash: Hex,
  stepHashes: Record<string, Hex>,
  plan: WithdrawPlan
}
*/
// ANCHOR_END: handle

// ANCHOR: status
const s = await sdk.withdrawals.status(handle);
// { phase, l2TxHash, key? }
// ANCHOR_END: status
expect(s.phase).toBeString();

// ANCHOR: receipt-1
const l2Rcpt = await sdk.withdrawals.wait(handle, { for: 'l2' });
await sdk.withdrawals.wait(handle, { for: 'ready', pollMs: 6000, timeoutMs: 15 * 60_000 });
// ANCHOR_END: receipt-1

// ANCHOR: finalize
const { status, receipt } = await sdk.withdrawals.finalize(handle.l2TxHash);
if (status.phase === 'FINALIZED') {
  console.log('L1 tx:', receipt?.transactionHash);
}
// ANCHOR_END: finalize

// ANCHOR: receipt-2
const l1Rcpt = await sdk.withdrawals.wait(handle, { for: 'finalized', pollMs: 7000 });
// ANCHOR_END: receipt-2
expect(l1Rcpt?.transactionHash).toContain("0x");
const finalStatus = await sdk.withdrawals.status(handle);
expect(finalStatus.phase).toEqual("FINALIZED");
});

it('creates a withdrawal 3', async () => {
const account = me;
const sdk = viemSDK;
const token = ETH_ADDRESS;
const amount = parseEther('0.01');
const to = account.address;
// ANCHOR: min-happy-path
const handle = await sdk.withdrawals.create({ token, amount, to });

// L2 inclusion
await sdk.withdrawals.wait(handle, { for: 'l2' });

// Option A: wait for readiness, then finalize
await sdk.withdrawals.wait(handle, { for: 'ready' });
await sdk.withdrawals.finalize(handle.l2TxHash);

// Option B: finalize immediately (will throw if not ready)
// await sdk.withdrawals.finalize(handle.l2TxHash);
// ANCHOR_END: min-happy-path
});

});
