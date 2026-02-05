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
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:imports}}

{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:init-sdk}}
```

## Quick Start

Withdraw **0.1 ETH** from L2 → L1 and finalize on L1:

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:eth-import}}

{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:create-withdrawal}}
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
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:quote}}
```

### `tryQuote(p) → Promise<{ ok: true; value: WithdrawQuote } | { ok: false; error }>`

Result-style `quote`.

### `prepare(p: WithdrawParams) → Promise<WithdrawPlan<TransactionRequest>>`

Build the plan (ordered L2 steps + unsigned transactions) without sending.

**Returns:** `WithdrawPlan`

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:plan}}
```

### `tryPrepare(p) → Promise<{ ok: true; value: WithdrawPlan } | { ok: false; error }>`

Result-style `prepare`.

### `create(p: WithdrawParams) → Promise<WithdrawHandle<TransactionRequest>>`

Prepares and **executes** all required **L2** steps.
Returns a handle containing the **L2 transaction hash**.

**Returns:** `WithdrawHandle`

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:handle}}
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
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:status}}
```

### `wait(handleOrHash, { for: 'l2' | 'ready' | 'finalized', pollMs?, timeoutMs? })`

Block until a target phase is reached.

* `{ for: 'l2' }` → resolves **L2 receipt** (`TransactionReceiptZKsyncOS`) or `null`
* `{ for: 'ready' }` → resolves `null` once finalizable
* `{ for: 'finalized' }` → resolves **L1 receipt** (if found) or `null`

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:receipt-1}}
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:receipt-2}}
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
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:finalize}}
```

> [!INFO]
> If not ready, `finalize()` throws a typed `STATE` error.
> Use `status()` or `wait(..., { for: 'ready' })` first to avoid that.

### `tryFinalize(l2TxHash) → Promise<{ ok: true; value: { status: WithdrawalStatus; receipt?: TransactionReceipt } } | { ok: false; error }>`

Result-style `finalize`.

## End-to-End Example

### Minimal Happy Path

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:min-happy-path}}
```

---

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

* **Two chains, two receipts:** Inclusion on **L2** and finalization on **L1** are independent events.
* **Polling strategy:** For production UIs, prefer `wait({ for: 'ready' })` then `finalize()` to avoid premature finalization.
* **Approvals:** If an ERC-20 requires allowances, `create()` automatically includes those approval steps.
