# Withdrawals

L2 → L1 withdrawals for ETH and ERC-20 tokens with quote, prepare, create, status, wait, and finalize helpers using the **Viem adapter**.

---

## At a Glance

* **Resource:** `sdk.withdrawals`
* **Typical flow:** `quote → create → wait({ for: 'l2' }) → wait({ for: 'ready' }) → finalize`
* **Auto-routing:** ETH vs ERC-20 and base-token vs non-base handled automatically
* **Error style:** Throwing methods (`quote`, `prepare`, `create`, `status`, `wait`, `finalize`) + safe result variants (`tryQuote`, `tryPrepare`, `tryCreate`, `tryWait`, `tryFinalize`)
* **Token mapping:** Use `sdk.tokens` if you need L1/L2 token addresses or assetIds ahead of time.

## Import

```ts
{{#include ../../../snippets/viem/reference/withdrawals.test.ts:imports}}

{{#include ../../../snippets/viem/reference/withdrawals.test.ts:init-sdk}}
```

## Quick Start

Withdraw **0.1 ETH** from L2 → L1 and finalize on L1:

```ts
{{#include ../../../snippets/viem/reference/withdrawals.test.ts:eth-import}}

{{#include ../../../snippets/viem/reference/withdrawals.test.ts:create-withdrawal}}
```

> [!INFO]
> Withdrawals are two-phase: inclusion on **L2**, then **finalization on L1**.
> You can call `finalize` directly, but it will throw if not yet ready.
> Prefer `wait(..., { for: 'ready' })` to avoid premature finalization errors.

## Route Selection (Automatic)

| Route           | Meaning                                              |
| --------------- | ---------------------------------------------------- |
| `base`          | Withdrawing the **base token** (ETH or otherwise)    |
| `erc20-nonbase` | Withdrawing an ERC-20 that is **not** the base token |

Routes are derived automatically from network metadata and the supplied `token`.

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
{{#include ../../../snippets/viem/reference/withdrawals.test.ts:quote}}
```

**Fee estimation notes**

- If `approvalsNeeded` is non-empty, the withdraw gas estimate may be unavailable and `fees.l2` can be zeros. Treat this as **unknown**, not free.
- After the approval transaction is confirmed, call `quote` or `prepare` again to get a withdraw fee estimate.
- `quote` only covers the withdraw transaction. Approval gas is not included in the fee breakdown.

### `tryQuote(p) → Promise<{ ok: true; value: WithdrawQuote } | { ok: false; error }>`

Result-style `quote`.

### `prepare(p: WithdrawParams) → Promise<WithdrawPlan<TransactionRequest>>`

Builds the plan (ordered L2 steps + unsigned txs) without sending.

**Returns:** `WithdrawPlan`

```ts
{{#include ../../../snippets/viem/reference/withdrawals.test.ts:plan}}
```

### `tryPrepare(p) → Promise<{ ok: true; value: WithdrawPlan } | { ok: false; error }>`

Result-style `prepare`.

### `create(p: WithdrawParams) → Promise<WithdrawHandle<TransactionRequest>>`

Prepares and **executes** the required **L2** steps.
Returns a handle with the **L2 transaction hash**.

**Returns:** `WithdrawHandle`

```ts
{{#include ../../../snippets/viem/reference/withdrawals.test.ts:handle}}
```

> [!WARNING]
> If any L2 step reverts, `create()` throws a typed error.
> Use `tryCreate()` to avoid exceptions and return a result object.

### `tryCreate(p) → Promise<{ ok: true; value: WithdrawHandle } | { ok: false; error }>`

Result-style `create`.

### `status(handleOrHash) → Promise<WithdrawalStatus>`

Reports the current phase of a withdrawal.
Accepts a `WithdrawHandle` or raw **L2 tx hash**.

| Phase               | Meaning                                |
| ------------------- | -------------------------------------- |
| `UNKNOWN`           | No L2 hash provided                    |
| `L2_PENDING`        | L2 receipt not yet available           |
| `PENDING`           | Included on L2 but not yet finalizable |
| `READY_TO_FINALIZE` | Can be finalized on L1                 |
| `FINALIZED`         | Already finalized on L1                |

```ts
{{#include ../../../snippets/viem/reference/withdrawals.test.ts:status}}
```

### `wait(handleOrHash, { for: 'l2' | 'ready' | 'finalized', pollMs?, timeoutMs? })`

Wait until the withdrawal reaches a specific phase.

* `{ for: 'l2' }` → Resolves the **L2 receipt** (`TransactionReceiptZKsyncOS`) or `null`
* `{ for: 'ready' }` → Resolves `null` when finalizable
* `{ for: 'finalized' }` → Resolves the **L1 receipt** (if found) or `null`

```ts
{{#include ../../../snippets/viem/reference/withdrawals.test.ts:receipt-1}}
{{#include ../../../snippets/viem/reference/withdrawals.test.ts:receipt-2}}
```

> [!TIP]
> Default polling is **5500 ms** (minimum 1000 ms).
> Use `timeoutMs` for long polling windows.

### `tryWait(handleOrHash, opts) → Result<TransactionReceipt | null>`

Result-style `wait`.

### `finalize(l2TxHash: Hex) → Promise<{ status: WithdrawalStatus; receipt?: TransactionReceipt }>`

Send the **L1 finalize** transaction **if ready**.
If already finalized, returns the status without sending.

```ts
{{#include ../../../snippets/viem/reference/withdrawals.test.ts:finalize}}
```

> [!INFO]
> If not ready, `finalize()` throws a typed `STATE` error.
> Use `status()` or `wait(..., { for: 'ready' })` before calling to avoid exceptions.

### `tryFinalize(l2TxHash) → Promise<{ ok: true; value: { status: WithdrawalStatus; receipt?: TransactionReceipt } } | { ok: false; error }>`

Result-style `finalize`.

## End-to-End Example

```ts
{{#include ../../../snippets/viem/reference/withdrawals.test.ts:min-happy-path}}
```

## Types (Overview)

### Withdraw Params

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:params-type}}
```

### Withdraw Quote

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:quote-type}}
```

### Withdraw Plan

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:plan-type}}
```

### Withdraw Waitable

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:wait-type}}
```

### Withdraw Status

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:status-type}}
```

---

## Notes & Pitfalls

* **Two chains, two receipts:** Inclusion on **L2** and finalization on **L1** are separate phases.
* **Polling strategy:** In production UIs, prefer `wait({ for: 'ready' })` before `finalize()` to avoid premature attempts.
* **Approvals:** If ERC-20 approvals are needed for withdrawal, `create()` automatically handles them.
