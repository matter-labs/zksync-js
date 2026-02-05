# Withdrawals

L2 → L1 withdrawals for ETH and ERC-20 tokens with quote, prepare, create, status, wait, and finalize helpers.

---

## At a Glance

* **Resource:** `sdk.withdrawals`
* **Typical flow:** `quote → create → wait({ for: 'l2' }) → wait({ for: 'ready' }) → finalize`
* **Auto-routing:** ETH vs ERC-20 and base-token vs non-base handled internally
* **Error style:** Throwing methods (`quote`, `prepare`, `create`, `status`, `wait`, `finalize`) + safe variants (`tryQuote`, `tryPrepare`, `tryCreate`, `tryWait`, `tryFinalize`)
* **Token mapping:** Use `sdk.tokens` if you need L1/L2 token addresses or assetIds ahead of time.

## Import

```ts
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '@matterlabs/zksync-js/ethers';

const l1 = new JsonRpcProvider(process.env.ETH_RPC!);
const l2 = new JsonRpcProvider(process.env.ZKSYNC_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);
// sdk.withdrawals → WithdrawalsResource
```

## Quick Start

Withdraw **0.1 ETH** from L2 → L1 and finalize on L1:

```ts
const handle = await sdk.withdrawals.create({
  token: ETH_ADDRESS, // ETH sentinel supported
  amount: parseEther('0.1'),
  to: await signer.getAddress(), // L1 recipient
});

// 1) L2 inclusion (adds l2ToL1Logs if available)
await sdk.withdrawals.wait(handle, { for: 'l2' });

// 2) Wait until finalizable (no side effects)
await sdk.withdrawals.wait(handle, { for: 'ready', pollMs: 6000 });

// 3) Finalize on L1 (no-op if already finalized)
const { status, receipt: l1Receipt } = await sdk.withdrawals.finalize(handle.l2TxHash);
```

> [!INFO]
> Withdrawals are two-phase: inclusion on **L2**, then **finalization on L1**.
> You can call `finalize` directly; it will throw if not yet ready.
> Prefer `wait(..., { for: 'ready' })` to avoid that.

## Route Selection (Automatic)

| Route           | Meaning                                              |
| --------------- | ---------------------------------------------------- |
| `base`          | Withdrawing the **base token** (ETH or otherwise)    |
| `erc20-nonbase` | Withdrawing an ERC-20 that is **not** the base token |

You **don’t** pass a route manually; it’s derived from network metadata and the token.

## Method Reference

### `quote(p: WithdrawParams) → Promise<WithdrawQuote>`

Estimate the operation (route, approvals, gas hints). Does **not** send transactions.

**Parameters**

| Name            | Type                                          | Required | Description                                                           |
| --------------- | --------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `token`         | `Address`                                     | ✅        | L2 token (ETH sentinel supported).                                    |
| `amount`        | `bigint`                                      | ✅        | Amount in wei to withdraw.                                            |
| `to`            | `Address`                                     | ❌        | L1 recipient. Defaults to the signer’s address.                       |
| `l2GasLimit`    | `bigint`                                      | ❌        | Optional custom gas limit override for the L2 withdrawal transaction. |
| `l2TxOverrides` | [`Eip1559GasOverrides`](#eip1559gasoverrides) | ❌        | Optional EIP-1559 overrides for the L2 withdrawal transaction.        |

**Returns:** `WithdrawQuote`

```ts
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
```

**Fee estimation notes**

- If `approvalsNeeded` is non-empty, the withdraw gas estimate may be unavailable and `fees.l2` can be zeros. Treat this as **unknown**, not free.
- After the approval transaction is confirmed, call `quote` or `prepare` again to get a withdraw fee estimate.
- `quote` only covers the withdraw transaction. Approval gas is not included in the fee breakdown.

### `tryQuote(p) → Promise<{ ok: true; value: WithdrawQuote } | { ok: false; error }>`

Result-style `quote`.

### `prepare(p: WithdrawParams) → Promise<WithdrawPlan<TransactionRequest>>`

Build the plan (ordered L2 steps + unsigned transactions) without sending.

**Returns:** `WithdrawPlan`

```ts
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
```

### `tryPrepare(p) → Promise<{ ok: true; value: WithdrawPlan } | { ok: false; error }>`

Result-style `prepare`.

### `create(p: WithdrawParams) → Promise<WithdrawHandle<TransactionRequest>>`

Prepares and **executes** all required **L2** steps.
Returns a handle containing the **L2 transaction hash**.

**Returns:** `WithdrawHandle`

```ts
const handle = await sdk.withdrawals.create({ token, amount, to });
/*
{
  kind: "withdrawal",
  l2TxHash: Hex,
  stepHashes: Record<string, Hex>,
  plan: WithdrawPlan
}
*/
```

> [!WARNING]
> If any L2 step reverts, `create()` throws a typed error.
> Prefer `tryCreate()` to avoid exceptions.

### `tryCreate(p) → Promise<{ ok: true; value: WithdrawHandle } | { ok: false; error }>`

Result-style `create`.

### `status(handleOrHash) → Promise<WithdrawalStatus>`

Return the current phase of a withdrawal.
Accepts either a `WithdrawHandle` or a raw **L2 transaction hash**.

**Phases**

| Phase               | Meaning                                |
| ------------------- | -------------------------------------- |
| `UNKNOWN`           | No L2 hash provided                    |
| `L2_PENDING`        | L2 receipt missing                     |
| `PENDING`           | Included on L2 but not yet finalizable |
| `READY_TO_FINALIZE` | Can be finalized on L1 now             |
| `FINALIZED`         | Already finalized on L1                |

```ts
const s = await sdk.withdrawals.status(handle);
// { phase, l2TxHash, key? }
```

### `wait(handleOrHash, { for: 'l2' | 'ready' | 'finalized', pollMs?, timeoutMs? })`

Block until a target phase is reached.

* `{ for: 'l2' }` → resolves **L2 receipt** (`TransactionReceiptZKsyncOS`) or `null`
* `{ for: 'ready' }` → resolves `null` once finalizable
* `{ for: 'finalized' }` → resolves **L1 receipt** (if found) or `null`

```ts
const l2Rcpt = await sdk.withdrawals.wait(handle, { for: 'l2' });
await sdk.withdrawals.wait(handle, { for: 'ready', pollMs: 6000, timeoutMs: 15 * 60_000 });
const l1Rcpt = await sdk.withdrawals.wait(handle, { for: 'finalized', pollMs: 7000 });
```

> [!TIP]
> Default polling is 5500 ms (minimum 1000 ms).
> Use `timeoutMs` to bound long waits gracefully.

### `tryWait(handleOrHash, opts) → Result<TransactionReceipt | null>`

Result-style `wait`.

### `finalize(l2TxHash: Hex) → Promise<{ status: WithdrawalStatus; receipt?: TransactionReceipt }>`

Send the **L1 finalize** transaction — **only if ready**.
If already finalized, returns the current status without sending.

```ts
const { status, receipt } = await sdk.withdrawals.finalize(handle.l2TxHash);
if (status.phase === 'FINALIZED') {
  console.log('L1 tx:', receipt?.transactionHash);
}
```

> [!INFO]
> If not ready, `finalize()` throws a typed `STATE` error.
> Use `status()` or `wait(..., { for: 'ready' })` first to avoid that.

### `tryFinalize(l2TxHash) → Promise<{ ok: true; value: { status: WithdrawalStatus; receipt?: TransactionReceipt } } | { ok: false; error }>`

Result-style `finalize`.

## End-to-End Example

### Minimal Happy Path

```ts
const handle = await sdk.withdrawals.create({ token, amount, to });

// L2 inclusion
await sdk.withdrawals.wait(handle, { for: 'l2' });

// Option A: finalize immediately (will throw if not ready)
await sdk.withdrawals.finalize(handle.l2TxHash);

// Option B: wait for readiness, then finalize
await sdk.withdrawals.wait(handle, { for: 'ready' });
await sdk.withdrawals.finalize(handle.l2TxHash);
```

---

## Types (Overview)

```ts
export interface WithdrawParams {
  token: Address; // L2 token (ETH sentinel supported)
  amount: bigint; // wei
  to?: Address; // L1 recipient
  l2GasLimit?: bigint;
  l2TxOverrides?: Eip1559GasOverrides;
}

export interface Eip1559GasOverrides {
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface WithdrawQuote {
  route: 'base' | 'erc20-nonbase';
  summary: {
    route: 'base' | 'erc20-nonbase';
    approvalsNeeded: Array<{ token: Address; spender: Address; amount: bigint }>;
    amounts: {
      transfer: {
        token: Address;
        amount: bigint;
      };
    };
    fees: {
      token: Address;
      maxTotal: bigint;
      mintValue?: bigint;
      l2?: {
        gasLimit: bigint;
        maxFeePerGas: bigint;
        maxPriorityFeePerGas?: bigint;
        total: bigint;
      };
    };
  };
}

export interface WithdrawPlan<TTx = TransactionRequest> {
  route: WithdrawQuote['route'];
  summary: WithdrawQuote;
  steps: Array<{ key: string; kind: string; tx: TTx }>;
}

export interface WithdrawHandle<TTx = TransactionRequest> {
  kind: 'withdrawal';
  l2TxHash: Hex;
  stepHashes: Record<string, Hex>;
  plan: WithdrawPlan<TTx>;
}

export type WithdrawalStatus =
  | { phase: 'UNKNOWN'; l2TxHash: Hex }
  | { phase: 'L2_PENDING'; l2TxHash: Hex }
  | { phase: 'PENDING'; l2TxHash: Hex; key?: unknown }
  | { phase: 'READY_TO_FINALIZE'; l2TxHash: Hex; key: unknown }
  | { phase: 'FINALIZED'; l2TxHash: Hex; key: unknown };

// L2 receipt augmentation returned by wait({ for: 'l2' })
export type TransactionReceiptZKsyncOS = TransactionReceipt & {
  l2ToL1Logs?: Array<unknown>;
};
```

---

## Notes & Pitfalls

* **Two chains, two receipts:** Inclusion on **L2** and finalization on **L1** are independent events.
* **Polling strategy:** For production UIs, prefer `wait({ for: 'ready' })` then `finalize()` to avoid premature finalization.
* **Approvals:** If an ERC-20 requires allowances, `create()` automatically includes those approval steps.
