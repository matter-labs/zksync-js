// examples/deposit-eth.ts
import { createPublicClient, createWalletClient, http, parseEther, WalletClient } from 'viem';
import type { Account, Chain, Transport } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createViemSdk, createViemClient } from '@matterlabs/zksync-js/viem';
import { ETH_ADDRESS } from '@matterlabs/zksync-js/core';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

async function main() {
  if (!PRIVATE_KEY || PRIVATE_KEY.length !== 66) {
    throw new Error('Set your PRIVATE_KEY in the .env file');
  }

  // --- Viem clients ---
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2 = createPublicClient({ transport: http(L2_RPC) });
  const l1Wallet: WalletClient<Transport, Chain, Account> = createWalletClient({
    account,
    transport: http(L1_RPC),
  });

  // Check balances
  const [balL1, balL2] = await Promise.all([
    l1.getBalance({ address: account.address }),
    l2.getBalance({ address: account.address }),
  ]);
  console.log('L1 balance:', balL1.toString());
  console.log('L2 balance:', balL2.toString());

  // client + sdk
  const client = createViemClient({ l1, l2, l1Wallet });
  const sdk = createViemSdk(client);

  const me = account.address;
  const params = {
    amount: parseEther('0.01'), // 0.01 ETH
    to: me,
    token: ETH_ADDRESS,
    // optional:
    // l2GasLimit: 300_000n,
    // gasPerPubdata: 800n,
    // operatorTip: 0n,
    // refundRecipient: me,
  } as const;

  // Quote
  const quote = await sdk.deposits.quote(params);
  console.log('QUOTE response:', quote);

  // Prepare (route + steps, no sends)
  const prepared = await sdk.deposits.prepare(params);
  console.log('PREPARE response:', prepared);

  // Create (prepare + send)
  const created = await sdk.deposits.create(params);
  console.log('CREATE response:', created);

  // Status (quick check)
  const status = await sdk.deposits.status(created);
  console.log('STATUS response:', status);

  // Wait (L1 inclusion)
  const l1Receipt = await sdk.deposits.wait(created, { for: 'l1' });
  console.log(
    'L1 Included at block:',
    l1Receipt?.blockNumber,
    'status:',
    l1Receipt?.status,
    'hash:',
    l1Receipt?.transactionHash,
  );

  // Status again
  const status2 = await sdk.deposits.status(created);
  console.log('STATUS2 response:', status2);

  // Wait for L2 execution
  const l2Receipt = await sdk.deposits.wait(created, { for: 'l2' });
  console.log(
    'L2 Included at block:',
    l2Receipt?.blockNumber,
    'status:',
    l2Receipt?.status,
    'hash:',
    l2Receipt?.transactionHash,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
