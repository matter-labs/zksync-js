// examples/withdraw-erc20.ts
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
import { createViemSdk, createViemClient } from '@matterlabs/zksync-js/viem';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Replace with a real **L1 ERC-20 token address** you hold on L2
const L1_ERC20_TOKEN = '0x42E331a2613Fd3a5bc18b47AE3F01e1537fD8873';

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error('Set PRIVATE_KEY (0x-prefixed) in your environment.');
  }

  // --- Viem clients ---
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2 = createPublicClient({ transport: http(L2_RPC) });

  const l1Wallet: WalletClient<Transport, Chain, Account> = createWalletClient({
    account,
    transport: http(L1_RPC),
  });
  // Need to provide an L2 wallet client for sending L2 tx
  const l2Wallet = createWalletClient<Transport, Chain, Account>({
    account,
    transport: http(L2_RPC),
  });
  const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
  const sdk = createViemSdk(client);

  const me = account.address;

  // Resolve the L2-mapped token for an L1 ERC-20
  const l2Token = await sdk.tokens.toL2Address(L1_ERC20_TOKEN);

  // Withdraw params
  const params = {
    token: l2Token,
    amount: parseUnits('25', 18), // withdraw 25 tokens
    to: me,
    // l2GasLimit: 300_000n,
  } as const;

  // -------- Dry runs / planning --------
  console.log('TRY QUOTE:', await sdk.withdrawals.tryQuote(params));
  console.log('QUOTE:', await sdk.withdrawals.quote(params));
  console.log('TRY PREPARE:', await sdk.withdrawals.tryPrepare(params));
  console.log('PREPARE:', await sdk.withdrawals.prepare(params));

  // -------- Create (L2 approvals if needed + withdraw) --------
  const created = await sdk.withdrawals.create(params);
  console.log('CREATE:', created);

  // Wait for L2 inclusion
  const l2Receipt = await sdk.withdrawals.wait(created, { for: 'l2' });
  console.log(
    'L2 included: block=',
    l2Receipt?.blockNumber,
    'status=',
    l2Receipt?.status,
    'hash=',
    l2Receipt?.transactionHash,
  );

  console.log('STATUS (post-L2):', await sdk.withdrawals.status(created.l2TxHash));

  // Wait until the withdrawal is ready to finalize
  await sdk.withdrawals.wait(created.l2TxHash, { for: 'ready' });
  console.log('STATUS (ready):', await sdk.withdrawals.status(created.l2TxHash));

  // Finalize on L1
  const fin = await sdk.withdrawals.tryFinalize(created.l2TxHash);
  console.log(
    'FINALIZE:',
    fin.ok ? fin.value.status : fin.error,
    fin.ok ? (fin.value.receipt?.transactionHash ?? '(already finalized)') : '',
  );

  const l1Receipt = await sdk.withdrawals.wait(created.l2TxHash, { for: 'finalized' });
  if (l1Receipt) {
    console.log('L1 finalize receipt:', l1Receipt.transactionHash);
  } else {
    console.log('Finalized (no local L1 receipt available, possibly finalized by another actor).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
