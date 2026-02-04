import { beforeAll, describe, it } from 'bun:test';

import type { EthersSdk } from '../../../../src/adapters/ethers';

// ANCHOR: imports
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../../src/adapters/ethers';
import { ETH_ADDRESS } from '../../../../src/core';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
// ANCHOR_END: imports

describe('ethers withdraw ETH guide', () => {

let sdk: EthersSdk;
let signer: Wallet;

beforeAll(async () => {
// deposit some ETH first
  const l1 = new JsonRpcProvider(process.env.L1_RPC!);
  const l2 = new JsonRpcProvider(process.env.L2_RPC!);
  signer = new Wallet(process.env.PRIVATE_KEY!, l1);

  const client = createEthersClient({ l1, l2, signer });
  sdk = createEthersSdk(client);

  const params = {
    amount: parseEther('0.2'),
    to: await signer.getAddress() as `0x${string}`,
    token: ETH_ADDRESS,
  } as const;

  const handle = await sdk.deposits.create(params);
  await sdk.deposits.wait(handle, { for: 'l2' }); // funds available on L2
})

it('withdraws some ETH with main guide', async () => {
  await main();
});

it('withdraws some ETH with alt methods', async () => {
  await altMethods(sdk, signer);
});

});

// ANCHOR: main

async function main() {
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new Wallet(PRIVATE_KEY, l1);

  const client = createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  const me = (await signer.getAddress()) as `0x${string}`;

  // Withdraw params (ETH)
  const params = {
    token: ETH_ADDRESS,
    amount: parseEther('0.01'), // 0.01 ETH
    to: me,
    // l2GasLimit: 300_000n,
  } as const;

  // Quote (dry-run only)
  // ANCHOR: quote
  const quote = await sdk.withdrawals.quote(params);
  // ANCHOR_END: quote
  console.log('QUOTE: ', quote);

  // ANCHOR: prepare
  const plan = await sdk.withdrawals.prepare(params);
  // ANCHOR_END: prepare
  console.log('PREPARE: ', plan);

  // ANCHOR: create
  const handle = await sdk.withdrawals.create(params);
  // ANCHOR_END: create
  console.log('CREATE:', handle);

  // Quick status check
  // ANCHOR: status
  const s = await sdk.withdrawals.status(handle.l2TxHash); /* input can be handle or l2TxHash */
// s.phase: 'UNKNOWN' | 'L2_PENDING' | 'PENDING' | 'READY_TO_FINALIZE' | 'FINALIZED'
// ANCHOR_END: status
  console.log('STATUS (initial):', s.phase);

  // wait for L2 inclusion
  // ANCHOR: wait-for-l2
  const l2Receipt = await sdk.withdrawals.wait(handle, { for: 'l2' });
  // ANCHOR_END: wait-for-l2
  console.log(
    'L2 included: block=',
    l2Receipt?.blockNumber,
    'status=',
    l2Receipt?.status,
    'hash=',
    l2Receipt?.hash,
  );

  // Optional: check status again
  console.log('STATUS (post-L2):', await sdk.withdrawals.status(handle.l2TxHash));

  // finalize on L1
  // Use tryFinalize to avoid throwing in an example script
  // ANCHOR: wait-for-ready
  await sdk.withdrawals.wait(handle.l2TxHash, { for: 'ready' });
  // ANCHOR_END: wait-for-ready
  console.log('STATUS (ready):', await sdk.withdrawals.status(handle.l2TxHash));

  const fin = await sdk.withdrawals.tryFinalize(handle.l2TxHash);
  console.log('TRY FINALIZE: ', fin);

  const l1Receipt = await sdk.withdrawals.wait(handle.l2TxHash, { for: 'finalized' });
  if (l1Receipt) {
    console.log('L1 finalize receipt:', l1Receipt.hash);
  } else {
    console.log('Finalized (no local L1 receipt available, possibly finalized by another actor).');
  }
}
// ANCHOR_END: main

async function altMethods(sdk: EthersSdk, signer: Wallet){
  const me = (await signer.getAddress()) as `0x${string}`;

    const params = {
    token: ETH_ADDRESS,
    amount: parseEther('0.01'),
    to: me,
    // l2GasLimit: 300_000n,
  } as const;

  const handle = await sdk.withdrawals.create(params);
  await sdk.withdrawals.wait(handle, { for: 'ready' });

// ANCHOR: wfinalize
const result = await sdk.withdrawals.finalize(handle.l2TxHash);
console.log('Finalization result:', result);
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
  await sdk.withdrawals.wait(handle, { for: 'ready' });
  const f = await sdk.withdrawals.tryFinalize(handle.l2TxHash);
  if (!f.ok) {
    console.error('Finalize failed:', f.error);
  } else {
    console.log('Withdrawal finalized on L1:', f.value.receipt?.hash);
  }
}
// ANCHOR_END: tryCreate

}