// examples/deposit-erc20.ts
import {
  Account,
  Chain,
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  Transport,
  WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemSdk, createViemClient } from '@matterlabs/zksync-js/viem';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

async function main() {
  if (!PRIVATE_KEY) {
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

  // --- SDK ---
  const client = createViemClient({ l1, l2, l1Wallet });
  const sdk = createViemSdk(client);

  // sepolia example
  const TOKEN = '0x42E331a2613Fd3a5bc18b47AE3F01e1537fD8873';

  const me = account.address;
  const depositAmount = parseUnits('250', 18);

  // Optional (local): mint some tokens first if your ERC-20 supports `mint(address,uint256)`
  // const { request } = await l1.simulateContract({
  //   address: TOKEN,
  //   abi: IERC20ABI as const,
  //   functionName: 'mint',
  //   args: [me, amount] as const,
  //   account,
  // });
  // await l1Wallet.writeContract(request);

  // --- Quote ---
  const quote = await sdk.deposits.quote({ token: TOKEN, to: me, amount: depositAmount });
  console.log('QUOTE:', quote);

  // --- Prepare (route + steps, no sends) ---
  const prepared = await sdk.deposits.prepare({ token: TOKEN, to: me, amount: depositAmount });
  console.log('PREPARE:', prepared);

  // --- Create (prepare + send all steps) ---
  const created = await sdk.deposits.create({ token: TOKEN, to: me, amount: depositAmount });
  console.log('CREATE:', created);

  // Immediate status
  const status = await sdk.deposits.status(created);
  console.log('STATUS (immediate):', status);

  // Wait for L1 inclusion
  const l1Receipt = await sdk.deposits.wait(created, { for: 'l1' });
  console.log(
    'L1 Included at block:',
    l1Receipt?.blockNumber,
    'status:',
    l1Receipt?.status,
    'hash:',
    l1Receipt?.transactionHash,
  );

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
