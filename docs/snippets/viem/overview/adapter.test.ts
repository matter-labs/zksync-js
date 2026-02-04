import { beforeAll, describe, expect, it } from 'bun:test';

// ANCHOR: viem-adapter-imports
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '../../../../src/adapters/viem';
import { ETH_ADDRESS } from '../../../../src/core';
// ANCHOR_END: viem-adapter-imports

import type { ViemSdk, ViemClient } from '../../../../src/adapters/viem';
import type { Account } from 'viem';
import { l1Chain, l2Chain } from '../chains';

describe('viem adapter setup', () => {

let viemSDK: ViemSdk;
let viemClient: ViemClient;
let richAccount: Account;

beforeAll(async () => {
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(process.env.L1_RPC!) });
const l2Wallet = createWalletClient({ chain: l2Chain, account, transport: http(process.env.L2_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
const sdk = createViemSdk(client);

// ANCHOR: deposit-quote
const quote = await sdk.deposits.quote({
  token: ETH_ADDRESS,
  amount: parseEther('0.1'),
  to: account.address,
});

console.log('Max total fee:', quote.fees.maxTotal.toString());
// ANCHOR_END: deposit-quote

// ANCHOR: viem-deposit
const params = {
  amount: parseEther('0.1'),
  to: account.address,
  token: ETH_ADDRESS,
} as const;

const handle = await sdk.deposits.create(params);
await sdk.deposits.wait(handle, { for: 'l2' }); // funds available on L2
// ANCHOR_END: viem-deposit

viemSDK = sdk;
richAccount = account;
viemClient = client;
});

it('deposits some ETH', async () => {
const sdk = viemSDK;
const account = richAccount;

const params = {
  amount: parseEther('0.01'),
  to: account.address,
  token: ETH_ADDRESS,
} as const;

const handle = await sdk.deposits.create(params);

// ANCHOR: deposit-wait
const l1Rcpt = await sdk.deposits.wait(handle, { for: 'l1' });
const l2Rcpt = await sdk.deposits.wait(handle, { for: 'l2' });  // funds available on L2
// ANCHOR_END: deposit-wait

const handleOrL1Hash = handle;

// ANCHOR: deposit-status
const s = await sdk.deposits.status(handleOrL1Hash);
// s.phase ∈ 'UNKNOWN' | 'L1_PENDING' | 'L1_INCLUDED' | 'L2_PENDING' | 'L2_EXECUTED' | 'L2_FAILED'
// ANCHOR_END: deposit-status
expect(s.phase).toEqual("L2_EXECUTED");
});

it('try depositing some ETH', async () => {
const sdk = viemSDK;
const account = richAccount;

const params = {
  amount: parseEther('0.0001'),
  to: account.address,
  token: ETH_ADDRESS,
} as const;

// ANCHOR: try-deposit
try {
  const handle = await sdk.deposits.create(params);
} catch (e) {
  // normalized error envelope (type, operation, message, context, revert?)
}
// ANCHOR_END: try-deposit

// ANCHOR: try-create
const r = await sdk.deposits.tryCreate(params);

if (!r.ok) {
  // handle the error gracefully
  console.error('Deposit failed:', r.error);
  // maybe show a toast, retry, etc.
} else {
  const handle = r.value;
  console.log('Deposit sent. L1 tx hash:', handle.l1TxHash);
}
// ANCHOR_END: try-create
expect(r.ok).toEqual(true);
});

it('withdraws some ETH', async () => {
const sdk = viemSDK;
const account = richAccount;

const params = {
  amount: parseEther('0.01'),
  to: account.address,
  token: ETH_ADDRESS,
} as const;

const handle = await sdk.withdrawals.create(params);

// ANCHOR: withdraw-wait
// Wait for L2 inclusion → get L2 receipt (augmented with l2ToL1Logs if available)
const l2Rcpt = await sdk.withdrawals.wait(handle, { for: 'l2', pollMs: 5000 });

// Wait until it becomes finalizable (no side effects)
await sdk.withdrawals.wait(handle, { for: 'ready' });

// finalize on the L1
await sdk.withdrawals.tryFinalize(handle.l2TxHash);

// Wait for L1 finalization → L1 receipt (or null if not retrievable)
const l1Rcpt = await sdk.withdrawals.wait(handle, { for: 'finalized', timeoutMs: 15 * 60_000 });
// ANCHOR_END: withdraw-wait
expect(l1Rcpt?.status).toEqual("success");
});

it('withdraws some ETH 2', async () => {
const sdk = viemSDK;
const account = richAccount;

const params = {
  amount: parseEther('0.01'),
  to: account.address,
  token: ETH_ADDRESS,
} as const;

const handle = await sdk.withdrawals.create(params);

// ANCHOR: withdraw-poll
const ready = await sdk.withdrawals.wait(handle, {
  for: 'ready',
  pollMs: 5500, // minimum enforced internally
  timeoutMs: 30 * 60_000, // 30 minutes → returns null on deadline
});
if (ready === null) {
  // timeout or is finalizable — decide whether to retry or show a hint
}
// ANCHOR_END: withdraw-poll
await sdk.withdrawals.tryFinalize(handle.l2TxHash);

// ANCHOR: withdraw-try-wait
const r = await sdk.withdrawals.tryWait(handle, { for: 'finalized' });
if (!r.ok) {
  console.error('Finalize wait failed:', r.error);
} else {
  console.log('Finalized L1 receipt:', r.value);
}
// ANCHOR_END: withdraw-try-wait

const handleOrHash = handle;

// ANCHOR: withdraw-status
const s = await sdk.withdrawals.status(handleOrHash);
// s.phase ∈ 'UNKNOWN' | 'L2_PENDING' | 'PENDING' | 'READY_TO_FINALIZE' | 'FINALIZED'
// ANCHOR_END: withdraw-status
expect(s.phase).toEqual("FINALIZED");
});

it('withdraws some ETH 3', async () => {
const sdk = viemSDK;
const account = richAccount;

// ANCHOR: withdraw-short
// 1) Create on L2
const withdrawal = await sdk.withdrawals.create({
  token: ETH_ADDRESS,
  amount: parseEther('0.01'),
  to: account.address,
});

// 2) Wait until finalizable (no side effects)
await sdk.withdrawals.wait(withdrawal, { for: 'ready', pollMs: 5500 });

// 3) Finalize on L1
const { status, receipt } = await sdk.withdrawals.finalize(withdrawal.l2TxHash);

console.log(status.phase); // "FINALIZED"
console.log(receipt?.transactionHash); // L1 finalize tx hash
// ANCHOR_END: withdraw-short
expect(status.phase).toEqual("FINALIZED");

});

it('withdraws some ETH 3', async () => {
const sdk = viemSDK;
const account = richAccount;

const withdrawal = await sdk.withdrawals.create({
  token: ETH_ADDRESS,
  amount: parseEther('0.01'),
  to: account.address,
});

const l2TxHash = withdrawal.l2TxHash;

// ANCHOR: withdraw-by-hash
// Optionally confirm readiness first
const s = await sdk.withdrawals.status(l2TxHash);
if (s.phase !== 'READY_TO_FINALIZE') {
  await sdk.withdrawals.wait(l2TxHash, { for: 'ready', timeoutMs: 30 * 60_000 });
}

// Then finalize
const { status, receipt } = await sdk.withdrawals.finalize(l2TxHash);
// ANCHOR_END: withdraw-by-hash

// ANCHOR: withdraw-try-finalize
const r = await sdk.withdrawals.tryFinalize(l2TxHash);
if (!r.ok) {
  console.error('Finalize failed:', r.error);
} else {
  console.log('Status:', r.value.status);
  console.log('Finalized on L1 tx hash?:', r.value.receipt?.transactionHash);
}
// ANCHOR_END: withdraw-try-finalize

 const client = viemClient;

// ANCHOR: receipt-with-logs
const rcpt = await client.zks.getReceiptWithL2ToL1(l2TxHash);
console.log("L2 to L1 logs:", rcpt?.l2ToL1Logs); // always an array
// ANCHOR_END: receipt-with-logs

 //
// ANCHOR: log-proof
const proof = await client.zks.getL2ToL1LogProof(l2TxHash, 0);
/*
{
  id: bigint,
  batchNumber: bigint,
  proof: Hex[]
}
*/
// ANCHOR_END: log-proof
expect(proof.proof).toBeArray();
});

});
