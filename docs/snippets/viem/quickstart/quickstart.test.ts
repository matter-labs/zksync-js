import { describe, it } from 'bun:test';

// ANCHOR: quickstart-imports
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '../../../../src/adapters/viem';
import { ETH_ADDRESS } from '../../../../src/core';
// either import the chain from viem/chains or use defineChain 
import { l1Chain } from '../chains';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const L1_RPC_URL = process.env.L1_RPC;
const L2_RPC_URL = process.env.L2_RPC;
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

  // 1. SET UP CLIENTS AND ACCOUNT
  // The SDK needs connections to both L1 and L2 to function.
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

  const l1 = createPublicClient({ transport: http(L1_RPC_URL) });
  const l2 = createPublicClient({ transport: http(L2_RPC_URL) });
  const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(L1_RPC_URL) });

  // 2. INITIALIZE THE SDK CLIENT & SDK
  // The client bundles your viem clients; the SDK surface exposes deposits/withdrawals helpers.
  const client = createViemClient({ l1, l2, l1Wallet });
  const sdk = createViemSdk(client);

  const L1balance = await l1.getBalance({ address: account.address });
  const L2balance = await l2.getBalance({ address: account.address });

  console.log('Wallet balance on L1:', L1balance);
  console.log('Wallet balance on L2:', L2balance);

  // 3. PERFORM THE DEPOSIT
  // The create() method prepares and sends the transaction.
  // The wait() method polls until the transaction is complete.
  console.log('Sending deposit transaction...');
  const depositHandle = await sdk.deposits.create({
    token: ETH_ADDRESS,
    amount: parseEther('0.001'), // 0.001 ETH
    to: account.address,
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

  const L1balanceAfter = await l1.getBalance({ address: account.address });
  const L2balanceAfter = await l2.getBalance({ address: account.address });

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
      // Optional gas control:
      // l1TxOverrides: {
      //   gasLimit: 280_000n,
      //   maxFeePerGas: parseEther('0.00000002'),
      //   maxPriorityFeePerGas: parseEther('0.000000002'),
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