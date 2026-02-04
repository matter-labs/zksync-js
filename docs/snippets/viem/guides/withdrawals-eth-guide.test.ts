import { describe, it } from 'bun:test';

import type { ViemSdk } from "../../../../src/adapters/viem";

// ANCHOR: imports
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  type Account,
  type Chain,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createViemSdk, createViemClient } from '../../../../src/adapters/viem';
import { ETH_ADDRESS } from '../../../../src/core';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

const l1Chain = defineChain({
  id: 31337,
  name: "Local L1 Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [L1_RPC],
    },
  },
});

const l2Chain = defineChain({
  id: 6565,
  name: "local L2",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [L2_RPC],
    },
  },
});
// ANCHOR_END: imports

describe('viem withdraw ETH guide', () => {

it('withdraws some ETH', async () => {
  // deposit some ETH first
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2 = createPublicClient({ transport: http(L2_RPC) });

  const l1Wallet = createWalletClient<Transport, Chain, Account>({
    chain: l1Chain,
    account,
    transport: http(L1_RPC),
  });
  const l2Wallet = createWalletClient<Transport, Chain, Account>({
    chain: l2Chain,
    account,
    transport: http(L2_RPC),
  });

  const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
  const sdk = createViemSdk(client);
  const params = {
    amount: parseEther('0.2'),
    to: account.address,
    token: ETH_ADDRESS,
  } as const;

  const handle = await sdk.deposits.create(params);
  await sdk.deposits.wait(handle, { for: 'l2' });

  await main();
  await altMethods(sdk, account);
});

});

// ANCHOR: main
async function main() {
  if (!PRIVATE_KEY) {
    throw new Error('Set your PRIVATE_KEY (0x-prefixed 32-byte) in env');
  }

  // --- Viem clients  ---
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2 = createPublicClient({ transport: http(L2_RPC) });

  const l1Wallet = createWalletClient<Transport, Chain, Account>({
    chain: l1Chain,
    account,
    transport: http(L1_RPC),
  });
  const l2Wallet = createWalletClient<Transport, Chain, Account>({
    chain: l2Chain,
    account,
    transport: http(L2_RPC),
  });

  const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
  const sdk = createViemSdk(client);

  const me = account.address;

  // Withdraw ETH
  const params = {
    token: ETH_ADDRESS,
    amount: parseEther('0.01'),
    to: me,
    // l2GasLimit: 300_000n, // optional
  } as const;

  // Quote (dry run)
  // ANCHOR: quote
  const quote = await sdk.withdrawals.quote(params);
  // ANCHOR_END: quote
  console.log('QUOTE:', quote);

  // Prepare (no sends)
  // ANCHOR: prepare
  const plan = await sdk.withdrawals.prepare(params);
  // ANCHOR_END: prepare
  console.log('PREPARE:', plan);

  // Create (send L2 withdraw)
  // ANCHOR: create
  const handle = await sdk.withdrawals.create(params);
  // ANCHOR_END: create
  console.log('CREATE:', handle);

  // Quick status
  // ANCHOR: status
  const status = await sdk.withdrawals.status(handle.l2TxHash); // input can be handle or l2TxHash
  // status.phase: 'UNKNOWN' | 'L2_PENDING' | 'PENDING' | 'READY_TO_FINALIZE' | 'FINALIZED'
  // ANCHOR_END: status
  console.log('STATUS (initial):', status);

  // ANCHOR: wait
  // Wait for L2 inclusion
  const l2Receipt = await sdk.withdrawals.wait(handle, { for: 'l2' });
  console.log(
    'L2 included: block=',
    l2Receipt?.blockNumber,
    'status=',
    l2Receipt?.status,
    'hash=',
    l2Receipt?.transactionHash,
  );

  // Wait until ready to finalize
  await sdk.withdrawals.wait(handle.l2TxHash, { for: 'ready' }); // becomes finalizable
  // ANCHOR_END: wait
  console.log('STATUS (ready):', await sdk.withdrawals.status(handle.l2TxHash));

  // Try to finalize on L1
  const fin = await sdk.withdrawals.tryFinalize(handle.l2TxHash);
  console.log('TRY FINALIZE:', fin);

  const l1Receipt = await sdk.withdrawals.wait(handle.l2TxHash, { for: 'finalized' });
  if (l1Receipt) {
    console.log('L1 finalize receipt:', l1Receipt.transactionHash);
  } else {
    console.log('Finalized (no local L1 receipt — possibly finalized by someone else).');
  }
}
// ANCHOR_END: main

async function altMethods(sdk: ViemSdk, account: Account){
  const me = account.address;

  // Withdraw ETH
  const params = {
    token: ETH_ADDRESS,
    amount: parseEther('0.01'),
    to: me,
    // l2GasLimit: 300_000n, // optional
  } as const;

  const handle = await sdk.withdrawals.create(params);
  await sdk.withdrawals.wait(handle.l2TxHash, { for: 'ready' });

  // ANCHOR: wfinalize
  const result = await sdk.withdrawals.finalize(handle.l2TxHash);
  console.log('Finalization status:', result.status.phase);
  // ANCHOR_END: wfinalize

  // ANCHOR: try-catch-create
  try {
  const handle = await sdk.withdrawals.create(params);
} catch (e) {
  // normalized error envelope (type, operation, message, context, optional revert)
}
// ANCHOR_END: try-catch-create

// ANCHOR: tryCreate
const r = await sdk.withdrawals.tryCreate(params);

if (!r.ok) {
  console.error('Withdrawal failed:', r.error);
} else {
  const handle = r.value;
  await sdk.withdrawals.wait(handle.l2TxHash, { for: 'ready' });
  const f = await sdk.withdrawals.tryFinalize(handle.l2TxHash);
  if (!f.ok) {
    console.error('Finalize failed:', f.error);
  } else {
    console.log('Withdrawal finalized on L1:', f.value.receipt?.transactionHash);
  }
}
// ANCHOR_END: tryCreate

}