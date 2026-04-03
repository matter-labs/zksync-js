import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Account,
  type Chain,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '../../../src/adapters/viem';
import type { Address } from '../../../src/core';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const GW_RPC = process.env.GW_RPC ?? 'http://127.0.0.1:3052';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Amount of native ETH to send cross-chain (adjust as needed).
const AMOUNT = parseEther('0.001');

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY in env');

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const me = account.address as Address;

  console.log('Sender address:', me);

  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2Source = createPublicClient({ transport: http(SRC_L2_RPC) });
  const l2Destination = createPublicClient({ transport: http(DST_L2_RPC) });

  const l1Wallet = createWalletClient<Transport, Chain, Account>({
    account,
    transport: http(L1_RPC),
  });

  const client = createViemClient({ l1, l2: l2Source, l1Wallet });
  const sdk = createViemSdk(client, { interop: { gwChain: GW_RPC } });

  // Check balances before.
  const srcBalanceBefore = await l2Source.getBalance({ address: me });
  const dstBalanceBefore = await l2Destination.getBalance({ address: me });
  console.log('Source balance before:     ', formatEther(srcBalanceBefore), 'ETH');
  console.log('Destination balance before:', formatEther(dstBalanceBefore), 'ETH');

  const params = {
    actions: [
      {
        type: 'sendNative' as const,
        to: me,
        amount: AMOUNT,
      },
    ],
  };

  // QUOTE: Get cost estimate and approval requirements.
  const quote = await sdk.interop.quote(l2Destination, params);
  console.log('INTEROP QUOTE:', quote);

  // PREPARE: Build plan without executing.
  const prepared = await sdk.interop.prepare(l2Destination, params);
  console.log('PREPARE:', prepared);

  // CREATE: Execute the source-chain step(s).
  const created = await sdk.interop.create(l2Destination, params);
  console.log('CREATE:', created);

  // STATUS: Non-blocking lifecycle inspection.
  const st0 = await sdk.interop.status(l2Destination, created);
  console.log('STATUS after create:', st0);

  // WAIT: Block until the L2->L1 proof is available on source and the interop
  // root becomes available on the destination chain.
  const finalizationInfo = await sdk.interop.wait(l2Destination, created, {
    pollMs: 5_000,
    timeoutMs: 30 * 60 * 1_000,
  });
  console.log('Bundle finalized on source; root available on destination.');

  // FINALIZE: Execute on destination chain.
  const finalizationResult = await sdk.interop.finalize(l2Destination, finalizationInfo);
  console.log('FINALIZE RESULT:', finalizationResult);

  // STATUS: Terminal status (EXECUTED).
  const st1 = await sdk.interop.status(l2Destination, created);
  console.log('STATUS after finalize:', st1);

  // Check balances after.
  const dstBalanceAfter = await l2Destination.getBalance({ address: me });
  console.log('Destination balance after:', formatEther(dstBalanceAfter), 'ETH');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
