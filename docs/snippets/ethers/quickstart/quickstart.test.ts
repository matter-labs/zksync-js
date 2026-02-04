import { describe, it } from 'bun:test';

// ANCHOR: quickstart-imports
import 'dotenv/config'; // Load environment variables from .env
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../../src/adapters/ethers';
import { ETH_ADDRESS } from '../../../../src/core';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const L1_RPC_URL = process.env.L1_RPC_URL;
const L2_RPC_URL = process.env.L2_RPC_URL;
// ANCHOR_END: quickstart-imports

describe('viem quickstart', () => {

it('deposits some ETH and checks balances', async () => {
  await main();
});

});

// ANCHOR: quickstart-main

async function main() {
  if (!PRIVATE_KEY || !L1_RPC_URL || !L2_RPC_URL) {
    throw new Error('Please set your PRIVATE_KEY, L1_RPC_URL, and L2_RPC_URL in a .env file');
  }

  // 1. SET UP PROVIDERS AND SIGNER
  // The SDK needs connections to both L1 and L2 to function.
  const l1Provider = new JsonRpcProvider(L1_RPC_URL);
  const l2Provider = new JsonRpcProvider(L2_RPC_URL);
  const signer = new Wallet(PRIVATE_KEY, l1Provider);

  // 2. INITIALIZE THE SDK & CLIENT
  // The client is the low-level interface for interacting with the API.
  const client = createEthersClient({
    l1: l1Provider,
    l2: l2Provider,
    signer,
  });
  const sdk = createEthersSdk(client);

  const L1balance = await l1Provider.getBalance(signer.address);
  const L2balance = await l2Provider.getBalance(signer.address);

  console.log('Wallet balance on L1:', L1balance);
  console.log('Wallet balance on L2:', L2balance);

  // 3. PERFORM THE DEPOSIT
  // The create() method prepares and sends the transaction.
  // The wait() method polls until the transaction is complete.
  console.log('Sending deposit transaction...');
  const depositHandle = await sdk.deposits.create({
    token: ETH_ADDRESS,
    amount: parseEther('0.001'), // 0.001 ETH
    to: signer.address as `0x${string}`,
  });

  console.log(`L1 transaction hash: ${depositHandle.l1TxHash}`);
  console.log('Waiting for the deposit to be confirmed on L1...');

  // Wait for L1 inclusion
  const l1Receipt = await sdk.deposits.wait(depositHandle, { for: 'l1' });
  console.log(`Deposit confirmed on L1 in block ${l1Receipt?.blockNumber}`);

  console.log('Waiting for the deposit to be executed on L2...');

  // Wait for L2 execution
  const l2Receipt = await sdk.deposits.wait(depositHandle, { for: 'l2' });
  console.log(`Deposit executed on L2 in block ${l2Receipt?.blockNumber}`);
  console.log('Deposit complete! ✅');

  const L1balanceAfter = await l1Provider.getBalance(signer.address);
  const L2balanceAfter = await l2Provider.getBalance(signer.address);

  console.log('Wallet balance on L1 after:', L1balanceAfter);
  console.log('Wallet balance on L2 after:', L2balanceAfter);

  /*
    // OPTIONAL: ADVANCED CONTROL
    // The SDK also lets you inspect a transaction before sending it.
    // This follows the Mental Model: quote -> prepare -> create.
    // Uncomment the code below to see it in action.

    const params = {
      token: ETH_ADDRESS,
      amount: parseEther('0.001'),
      to: account.address,
      // Optional: pin gas fees instead of using provider estimates
      // l1TxOverrides: {
      //   gasLimit: 280_000n,
      //   maxFeePerGas: parseEther('0.00000002'), // 20 gwei
      //   maxPriorityFeePerGas: parseEther('0.000000002'), // 2 gwei
      // },
    };

    // Get a quote for the fees
    const quote = await sdk.deposits.quote(params);
    console.log('Fee quote:', quote);

    // Prepare the transaction without sending
    const plan = await sdk.deposits.prepare(params);
    console.log('Transaction plan:', plan);
  */
}
// ANCHOR_END: quickstart-main