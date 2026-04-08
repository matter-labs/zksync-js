import { JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../src/adapters/ethers';
import type { Address } from '../../../src/core';
import { getFundsReceiverAddress } from './utils';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const GW_RPC = process.env.GW_RPC ?? 'http://127.0.0.1:3052';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Amount of native ETH to send cross-chain (adjust as needed).
const AMOUNT = parseEther('0.001');

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY in env');

  const l1 = new JsonRpcProvider(L1_RPC);
  const l2Source = new JsonRpcProvider(SRC_L2_RPC);
  const l2Destination = new JsonRpcProvider(DST_L2_RPC);

  const signer = new Wallet(PRIVATE_KEY, l2Source);
  const me = signer.address as Address;

  console.log('Sender address:', me);

  // Deploy FundsReceiver to the destination chain — it must implement receiveMessage (ERC-7786).
  const dstSigner = new Wallet(PRIVATE_KEY, l2Destination);
  console.log('Deploying FundsReceiver on destination chain...');
  const fundsReceiver = await getFundsReceiverAddress({ signer: dstSigner });
  console.log('FundsReceiver deployed at:', fundsReceiver);

  const client = createEthersClient({
    l1,
    l2: l2Source,
    signer,
  });
  const sdk = createEthersSdk(client, {
    interop: { gwChain: GW_RPC },
  });

  // Check balances before.
  const srcBalanceBefore = await l2Source.getBalance(me);
  const receiverBalanceBefore = await l2Destination.getBalance(fundsReceiver);
  console.log('Source balance before:          ', formatEther(srcBalanceBefore), 'ETH');
  console.log('FundsReceiver balance before:   ', formatEther(receiverBalanceBefore), 'ETH');

  const params = {
    actions: [
      {
        type: 'sendNative' as const,
        to: fundsReceiver,
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

  // CREATE: Execute the source-chain step(s), wait for each tx receipt to confirm (status != 0).
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

  // FINALIZE: Execute on destination and block until done.
  const finalizationResult = await sdk.interop.finalize(l2Destination, finalizationInfo);
  console.log('FINALIZE RESULT:', finalizationResult);

  // STATUS: Terminal status (EXECUTED).
  const st1 = await sdk.interop.status(l2Destination, created);
  console.log('STATUS after finalize:', st1);

  // Check FundsReceiver balance after — should equal AMOUNT.
  const receiverBalanceAfter = await l2Destination.getBalance(fundsReceiver);
  console.log('FundsReceiver balance after:    ', formatEther(receiverBalanceAfter), 'ETH');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
