import { beforeAll, describe, expect, it } from 'bun:test';

// ANCHOR: imports
import { createViemClient, createViemSdk } from '../../../../src/adapters/viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
// ANCHOR_END: imports
import { l1Chain, l2Chain } from '../chains';
// ANCHOR: eth-import
import { ETH_ADDRESS } from '../../../../src/core/constants';
// ANCHOR_END: eth-import
import type { ViemSdk } from '../../../../src/adapters/viem';
import type { Account } from 'viem';

describe('viem deposits', () => {

  let viemSDK: ViemSdk;
  let me: Account;

beforeAll(() => {
// ANCHOR: init-sdk
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(process.env.L1_RPC!) });
const l2Wallet = createWalletClient({ chain: l2Chain, account, transport: http(process.env.L2_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
const sdk = createViemSdk(client);
// sdk.deposits → DepositsResource
// ANCHOR_END: init-sdk
  viemSDK = sdk;
  me = account;
})

it('creates a deposit', async () => {
const account = me;
const sdk = viemSDK;
// ANCHOR: create-deposit
const depositHandle = await sdk.deposits.create({
  token: ETH_ADDRESS,
  amount: parseEther('0.1'),
  to: account.address,
});

const l2TxReceipt = await sdk.deposits.wait(depositHandle, { for: 'l2' }); // null only if no L1 hash
// ANCHOR_END: create-deposit

const to = account.address;
const token = ETH_ADDRESS;
const amount = parseEther("0.01");


// ANCHOR: quote-deposit
const q = await sdk.deposits.quote({
  token: ETH_ADDRESS,
  amount: parseEther('0.25'),
  to,
});
/*
{
  route: "eth-base" | "eth-nonbase" | "erc20-base" | "erc20-nonbase",
  summary: {
    route,
    approvalsNeeded: [{ token, spender, amount }],
    amounts: {
      transfer: { token, amount }
    },
    fees: {
      token,
      maxTotal,
      mintValue,
      l1: { gasLimit, maxFeePerGas, maxPriorityFeePerGas, maxTotal },
      l2: { total, baseCost, operatorTip, gasLimit, maxFeePerGas, maxPriorityFeePerGas, gasPerPubdata }
    },
    baseCost,
    mintValue
  }
}
*/
// ANCHOR_END: quote-deposit
expect(q.route).toEqual('eth-base');

// ANCHOR: plan-deposit
const plan = await sdk.deposits.prepare({
  token,
  amount,
  to
});
/*
{
  route,
  summary: DepositQuote,
  steps: [
    { key: "approve:USDC", kind: "approve", tx: TransactionRequest },
    { key: "bridge", kind: "bridge", tx: TransactionRequest }
  ]
}
*/
// ANCHOR_END: plan-deposit
expect(plan.steps).toBeArray();

// ANCHOR: handle
const handle = await sdk.deposits.create({ token, amount, to });
/*
{
  kind: "deposit",
  l1TxHash: Hex,
  stepHashes: Record<string, Hex>,
  plan: DepositPlan
}
*/
// ANCHOR_END: handle


// ANCHOR: status
const s = await sdk.deposits.status(handle);
// { phase, l1TxHash, l2TxHash? }
// ANCHOR_END: status
expect(s.phase).toBeString();

// ANCHOR: wait
const l1Receipt = await sdk.deposits.wait(handle, { for: 'l1' });
const l2Receipt = await sdk.deposits.wait(handle, { for: 'l2' });
// ANCHOR_END: wait
expect(l1Receipt?.transactionHash).toContain("0x");
expect(l2Receipt?.transactionHash).toContain("0x");
});

it('creates a deposit 2', async () => {
const account = me;
const sdk = viemSDK;
// ANCHOR: create-eth-deposit
const handle = await sdk.deposits.create({
  token: ETH_ADDRESS,
  amount: parseEther('0.001'),
  to: account.address,
});

await sdk.deposits.wait(handle, { for: 'l2' });
// ANCHOR_END: create-eth-deposit

// ANCHOR: token-address
const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' // Example: USDC
// ANCHOR_END: token-address
});

it('creates a token deposit', async () => {
const account = me;
const sdk = viemSDK;
const token = ETH_ADDRESS;

// ANCHOR: create-token-deposit
const handle = await sdk.deposits.create({
  token,
  amount: 1_000_000n, // 1.0 USDC (6 decimals)
  to: account.address
});

const l1Receipt = await sdk.deposits.wait(handle, { for: 'l1' });
// ANCHOR_END: create-token-deposit

});

});
