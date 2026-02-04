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
import type { WithdrawalStatus as WStatus, WithdrawalWaitable as WWaitable, WithdrawParams as WParams } from '../../../../src/core/types/flows/withdrawals';
import type { TransactionReceiptZKsyncOS as ZKReceipt } from '../../../../src/adapters/ethers/resources/withdrawals/routes/types';
import type { TransactionReceipt } from "ethers";

// ANCHOR: params-type
type TxOverrides = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint | undefined;
}

interface WithdrawParams {
  token: Address;
  amount: bigint;
  to?: Address;
  refundRecipient?: Address;
  l2TxOverrides?: TxOverrides;
}
// ANCHOR_END: params-type

// ANCHOR: quote-type
/** Routes */
type WithdrawRoute = 'base' | 'erc20-nonbase';

interface ApprovalNeed {
  token: Address;
  spender: Address;
  amount: bigint;
}

type L2WithdrawalFeeParams = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  total: bigint;
};

type WithdrawalFeeBreakdown = {
  token: Address; // fee token address
  maxTotal: bigint; // max amount that can be charged
  mintValue?: bigint;
  l2?: L2WithdrawalFeeParams;
};

/** Quote */
interface WithdrawQuote {
  route: WithdrawRoute;
  approvalsNeeded: readonly ApprovalNeed[];
  amounts: {
    transfer: { token: Address; amount: bigint };
  };
  fees: WithdrawalFeeBreakdown;
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
type WithdrawPlan<Tx> = Plan<Tx, WithdrawRoute, WithdrawQuote>;
// ANCHOR_END: plan-type

// ANCHOR: wait-type
interface Handle<TxHashMap extends Record<string, Hex>, Route, PlanT> {
  kind: 'deposit' | 'withdrawal';
  route?: Route;
  stepHashes: TxHashMap; // step key -> tx hash
  plan: PlanT;
}

/** Handle */
interface WithdrawHandle<Tx>
  extends Handle<Record<string, Hex>, WithdrawRoute, WithdrawPlan<Tx>> {
  kind: 'withdrawal';
  l2TxHash: Hex;
  l1TxHash?: Hex;
  l2BatchNumber?: number;
  l2MessageIndex?: number;
  l2TxNumberInBatch?: number;
}

/** Waitable */
type WithdrawalWaitable = Hex | { l2TxHash?: Hex; l1TxHash?: Hex } | WithdrawHandle<unknown>;

interface L2ToL1Log {
  l2ShardId?: number;
  isService?: boolean;
  txNumberInBlock?: number;
  sender?: Address;
  key?: Hex;
  value?: Hex;
}

// L2 receipt augmentation returned by wait({ for: 'l2' })
type TransactionReceiptZKsyncOS = TransactionReceipt & {
  l2ToL1Logs?: L2ToL1Log[];
};
// ANCHOR_END: wait-type

// ANCHOR: status-type
type WithdrawalKey = {
  chainIdL2: bigint;
  l2BatchNumber: bigint;
  l2MessageIndex: bigint;
};

type WithdrawalPhase =
  | 'L2_PENDING' // tx not in an L2 block yet
  | 'L2_INCLUDED' // we have the L2 receipt
  | 'PENDING' // inclusion known; proof data not yet derivable/available
  | 'READY_TO_FINALIZE' // Ready to call finalize on L1
  | 'FINALIZING' // L1 tx sent but not picked up yet
  | 'FINALIZED' // L2-L1 tx finalized on L1
  | 'FINALIZE_FAILED' // prior L1 finalize reverted
  | 'UNKNOWN';

// Withdrawal Status
type WithdrawalStatus = {
  phase: WithdrawalPhase;
  l2TxHash: Hex;
  l1FinalizeTxHash?: Hex;
  key?: WithdrawalKey;
};
// ANCHOR_END: status-type



describe('ethers withdrawals', () => {

  let ethersSDK: EthersSdk;
  let me: Wallet;

beforeAll(() => {
// ANCHOR: init-sdk
const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2 = new JsonRpcProvider(process.env.L2_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);
// sdk.withdrawals → WithdrawalsResource
// ANCHOR_END: init-sdk
  ethersSDK = sdk;
  me = signer
})

// this test will always succeed
// but any errors will be highlighted
it('checks to see if the withdraw types are updated', async () => {
    const _paramsType: Exact<WithdrawParams, WParams> = true;
    const _waitableType: Exact<WithdrawalWaitable, WWaitable> = true;
    const _statusType: Exact<WithdrawalStatus, WStatus> = true;
    const _txReceiptWLogsType: Exact<TransactionReceiptZKsyncOS, ZKReceipt> = true;
});

it('creates a withdrawal', async () => {
const signer = me;
const sdk = ethersSDK;
// ANCHOR: create-withdrawal
const handle = await sdk.withdrawals.create({
  token: ETH_ADDRESS, // ETH sentinel supported
  amount: parseEther('0.1'),
  to: await signer.getAddress() as `0x${string}`, // L1 recipient
});

// 1) L2 inclusion (adds l2ToL1Logs if available)
await sdk.withdrawals.wait(handle, { for: 'l2' });

// 2) Wait until finalizable (no side effects)
await sdk.withdrawals.wait(handle, { for: 'ready', pollMs: 6000 });

// 3) Finalize on L1 (no-op if already finalized)
const { status, receipt: l1Receipt } = await sdk.withdrawals.finalize(handle.l2TxHash);
// ANCHOR_END: create-withdrawal
});

it('creates a withdrawal 2', async () => {
const signer = me;
const sdk = ethersSDK;
const token = ETH_ADDRESS;
const amount = parseEther('0.01');
const to = await signer.getAddress() as `0x${string}`;

// ANCHOR: quote
const q = await sdk.withdrawals.quote({ token, amount, to });
/*
{
  route: "base" | "erc20-nonbase",
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
      l2: { gasLimit, maxFeePerGas, maxPriorityFeePerGas, total }
    }
  }
}
*/
// ANCHOR_END: quote
expect(q.route).toEqual("base");

// ANCHOR: plan
const plan = await sdk.withdrawals.prepare({ token, amount, to });
/*
{
  route,
  summary: WithdrawQuote,
  steps: [
    { key, kind, tx: TransactionRequest },
    // …
  ]
}
*/
// ANCHOR_END: plan
expect(plan.route).toEqual("base");

// ANCHOR: handle
const handle = await sdk.withdrawals.create({ token, amount, to });
/*
{
  kind: "withdrawal",
  l2TxHash: Hex,
  stepHashes: Record<string, Hex>,
  plan: WithdrawPlan
}
*/
// ANCHOR_END: handle

// ANCHOR: status
const s = await sdk.withdrawals.status(handle);
// { phase, l2TxHash, key? }
// ANCHOR_END: status
expect(s.phase).toBeString();

// ANCHOR: receipt-1
const l2Rcpt = await sdk.withdrawals.wait(handle, { for: 'l2' });
await sdk.withdrawals.wait(handle, { for: 'ready', pollMs: 6000, timeoutMs: 15 * 60_000 });
// ANCHOR_END: receipt-1

// ANCHOR: finalize
const { status, receipt } = await sdk.withdrawals.finalize(handle.l2TxHash);
if (status.phase === 'FINALIZED') {
  console.log('L1 tx:', receipt?.hash);
}
// ANCHOR_END: finalize

// ANCHOR: receipt-2
const l1Rcpt = await sdk.withdrawals.wait(handle, { for: 'finalized', pollMs: 7000 });
// ANCHOR_END: receipt-2
expect(l1Rcpt?.hash).toContain("0x");
const finalStatus = await sdk.withdrawals.status(handle);
expect(finalStatus.phase).toEqual("FINALIZED");
});

it('creates a withdrawal 3', async () => {
const signer = me;
const sdk = ethersSDK;
const token = ETH_ADDRESS;
const amount = parseEther('0.01');
const to = await signer.getAddress() as `0x${string}`;
// ANCHOR: min-happy-path
const handle = await sdk.withdrawals.create({ token, amount, to });

// L2 inclusion
await sdk.withdrawals.wait(handle, { for: 'l2' });

// Option A: wait for readiness, then finalize
await sdk.withdrawals.wait(handle, { for: 'ready' });
await sdk.withdrawals.finalize(handle.l2TxHash);

// Option B: finalize immediately (will throw if not ready)
// await sdk.withdrawals.finalize(handle.l2TxHash);
// ANCHOR_END: min-happy-path
});

});
