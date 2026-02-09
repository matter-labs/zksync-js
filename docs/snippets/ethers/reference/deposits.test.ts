import { beforeAll, describe, expect, it } from 'bun:test';

// ANCHOR: imports
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../../src/adapters/ethers';
// ANCHOR_END: imports
// ANCHOR: eth-import
import { ETH_ADDRESS } from '../../../../src/core/constants';
// ANCHOR_END: eth-import
import type { EthersSdk } from '../../../../src/adapters/ethers';
import type { Address, Hex } from 'viem';
import type { Exact } from "../../core/types";
import type { DepositStatus as DStatus, DepositWaitable as DWaitable, DepositParams as DParams } from '../../../../src/core';

// ANCHOR: params-type
interface DepositParams {
  token: Address;
  amount: bigint;
  to?: Address;
  refundRecipient?: Address;
  l2GasLimit?: bigint;
  gasPerPubdata?: bigint;
  operatorTip?: bigint;
  l1TxOverrides?: TxOverrides;
}

type TxOverrides = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint | undefined;
}
// ANCHOR_END: params-type

// ANCHOR: quote-type
type DepositRoute = 'eth-base' | 'eth-nonbase' | 'erc20-base' | 'erc20-nonbase';

type L1DepositFeeParams = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  maxTotal: bigint;
};

type L2DepositFeeParams = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  total: bigint;
  baseCost: bigint;
  gasPerPubdata: bigint;
  operatorTip?: bigint;
};

type DepositFeeBreakdown = {
    token: `0x${string}`;
    maxTotal: bigint;
    mintValue?: bigint | undefined;
    l1?: L1DepositFeeParams | undefined;
    l2?: L2DepositFeeParams;
}

interface ApprovalNeed {
  token: Address;
  spender: Address;
  amount: bigint;
}

/** Quote */
interface DepositQuote {
  route: DepositRoute;
  approvalsNeeded: readonly ApprovalNeed[];
  amounts: {
    transfer: { token: Address; amount: bigint };
  };
  fees: DepositFeeBreakdown;
  /**
   * @deprecated Use `fees.components?.l2BaseCost` instead.
   * Will be removed in a future release.
   */
  baseCost?: bigint;
  /**
   * @deprecated Use `fees.components?.mintValue` instead.
   * Will be removed in a future release.
   */
  mintValue?: bigint;
}
// ANCHOR_END: quote-type

// ANCHOR: plan-type
interface PlanStep<Tx, Preview = undefined> {
  key: string;
  kind: string;
  description: string;
  /** Adapter-specific request (ethers TransactionRequest, viem WriteContractParameters, etc.) */
  tx: Tx;
  /** Optional compact, human-friendly view for logging/UI */
  preview?: Preview;
}

interface Plan<Tx, Route, Quote> {
  route: Route;
  summary: Quote;
  steps: Array<PlanStep<Tx>>;
}

/** Plan (Tx generic) */
type DepositPlan<Tx> = Plan<Tx, DepositRoute, DepositQuote>;
// ANCHOR_END: plan-type

// ANCHOR: wait-type
interface Handle<TxHashMap extends Record<string, Hex>, Route, PlanT> {
  kind: 'deposit' | 'withdrawal';
  route?: Route;
  stepHashes: TxHashMap; // step key -> tx hash
  plan: PlanT;
}

/** Handle */
interface DepositHandle<Tx>
  extends Handle<Record<string, Hex>, DepositRoute, DepositPlan<Tx>> {
  kind: 'deposit';
  l1TxHash: Hex;
  l2ChainId?: number;
  l2TxHash?: Hex;
}

/** Waitable */
type DepositWaitable = Hex | { l1TxHash: Hex } | DepositHandle<unknown>;
// ANCHOR_END: wait-type

// ANCHOR: status-type
// Status and phases
type DepositPhase =
  | 'L1_PENDING'
  | 'L1_INCLUDED' // L1 included, L2 hash not derived yet
  | 'L2_PENDING' // we have L2 hash, but no receipt yet
  | 'L2_EXECUTED' // L2 receipt.status === 1
  | 'L2_FAILED' // L2 receipt.status === 0
  | 'UNKNOWN';

// Deposit Status
type DepositStatus = {
  phase: DepositPhase;
  l1TxHash: Hex;
  l2TxHash?: Hex;
};
// ANCHOR_END: status-type

describe('ethers deposits', () => {

  let ethersSDK: EthersSdk;
  let me: Wallet;

beforeAll(() => {
// ANCHOR: init-sdk
const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2 = new JsonRpcProvider(process.env.L2_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);
// sdk.deposits → DepositsResource
// ANCHOR_END: init-sdk
  ethersSDK = sdk;
  me = signer
})

// this test will always succeed
// but any errors will be highlighted
it('checks to see if the deposit types are updated', async () => {
    const _paramsType: Exact<DepositParams, DParams> = true;
    const _waitableType: Exact<DepositWaitable, DWaitable> = true;
    const _statusType: Exact<DepositStatus, DStatus> = true;
});

it('creates a deposit', async () => {
const signer = me;
const sdk = ethersSDK;
// ANCHOR: create-deposit
const depositHandle = await sdk.deposits.create({
  token: ETH_ADDRESS,
  amount: parseEther('0.1'),
  to: await signer.getAddress() as `0x${string}`,
});

const l2TxReceipt = await sdk.deposits.wait(depositHandle, { for: 'l2' }); // null only if no L1 hash
// ANCHOR_END: create-deposit
});

it('creates a deposit 2', async () => {
const signer = me;
const sdk = ethersSDK;
const to = await signer.getAddress() as `0x${string}`;
const token = ETH_ADDRESS;
const amount = parseEther("0.01");

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
expect(l1Receipt?.hash).toContain("0x");
expect(l2Receipt?.hash).toContain("0x");
});

it('creates a deposit plan', async () => {
const signer = me;
const sdk = ethersSDK;
const to = await signer.getAddress() as `0x${string}`;
const token = ETH_ADDRESS;
const amount = parseEther("0.01");

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
});

it('creates a deposit quote', async () => {
const signer = me;
const sdk = ethersSDK;

const to = await signer.getAddress() as `0x${string}`;

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
});

it('creates a deposit 3', async () => {
const signer = me;
const sdk = ethersSDK;
// ANCHOR: create-eth-deposit
const handle = await sdk.deposits.create({
  token: ETH_ADDRESS,
  amount: parseEther('0.001'),
  to: await signer.getAddress() as `0x${string}`,
});

await sdk.deposits.wait(handle, { for: 'l2' });
// ANCHOR_END: create-eth-deposit

// ANCHOR: token-address
const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' // Example: USDC
// ANCHOR_END: token-address
});

it('creates a token deposit', async () => {
const signer = me;
const sdk = ethersSDK;
const token = ETH_ADDRESS;

// ANCHOR: create-token-deposit
const handle = await sdk.deposits.create({
  token,
  amount: 1_000_000n, // 1.0 USDC (6 decimals)
  to: await signer.getAddress() as `0x${string}`,
});

const l1Receipt = await sdk.deposits.wait(handle, { for: 'l1' });
// ANCHOR_END: create-token-deposit

});

});
