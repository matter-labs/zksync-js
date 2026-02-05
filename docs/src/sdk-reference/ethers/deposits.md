# Deposits

L1 → L2 deposits for ETH and ERC-20 tokens with quote, prepare, create, status, and wait helpers.

---

## At a Glance

* **Resource:** `sdk.deposits`
* **Typical flow:** `quote → create → wait({ for: 'l2' })`
* **Auto-routing:** ETH vs ERC-20 and base-token vs non-base handled automatically
* **Error style:** Throwing methods (`quote`, `prepare`, `create`, `wait`) + safe variants (`tryQuote`, `tryPrepare`, `tryCreate`, `tryWait`)
* **Token mapping:** Use `sdk.tokens` for L1⇄L2 token lookups and assetIds before calling into deposits if you need token metadata.

## Import

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:imports}}

{{#include ../../../snippets/ethers/reference/deposits.test.ts:init-sdk}}
```

## Quick Start

Deposit **0.1 ETH** from L1 → L2 and wait for **L2 execution**:

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:eth-import}}

{{#include ../../../snippets/ethers/reference/deposits.test.ts:create-deposit}}
```

> [!TIP]
> For UX that never throws, use the `try*` variants and branch on `ok`.

## Route Selection (Automatic)

| Route           | Meaning                                  |
| --------------- | ---------------------------------------- |
| `eth-base`      | ETH when L2 base token **is ETH**        |
| `eth-nonbase`   | ETH when L2 base token **≠ ETH**         |
| `erc20-base`    | ERC-20 that **is** the L2 base token     |
| `erc20-nonbase` | ERC-20 that **is not** the L2 base token |

You **don’t** pass a route manually; it’s derived from network metadata and the token.

## Method Reference

### `quote(p: DepositParams) → Promise<DepositQuote>`

Estimate the operation (route, approvals, gas hints). Does **not** send transactions.

**Parameters**

| Name              | Type                                          | Required | Description                                                        |
| ----------------- | --------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `token`           | `Address`                                     | ✅        | L1 token address. Use `0x…00` for ETH.                             |
| `amount`          | `bigint`                                      | ✅        | Amount in wei to deposit.                                          |
| `to`              | `Address`                                     | ❌        | L2 recipient address. Defaults to the signer’s address if omitted. |
| `refundRecipient` | `Address`                                     | ❌        | Optional address on L1 to receive refunds for unspent gas.         |
| `l2GasLimit`      | `bigint`                                      | ❌        | Optional manual L2 gas limit override.                             |
| `gasPerPubdata`   | `bigint`                                      | ❌        | Optional custom gas-per-pubdata value.                             |
| `operatorTip`     | `bigint`                                      | ❌        | Optional operator tip (in wei) for priority execution.             |
| `l1TxOverrides`   | [`Eip1559GasOverrides`](#eip1559gasoverrides) | ❌        | Optional EIP-1559 gas settings for the L1 transaction.             |


**Returns:** `DepositQuote`

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:quote-deposit}}
```

> [!TIP]
> If `summary.approvalsNeeded` is non-empty (ERC-20), `create()` will include those approval steps automatically.

### `tryQuote(p) → Promise<{ ok: true; value: DepositQuote } | { ok: false; error }>`

Result-style version of `quote`.

### `prepare(p: DepositParams) → Promise<DepositPlan<TransactionRequest>>`

Build the plan (ordered steps + unsigned transactions) without sending.

**Returns:** `DepositPlan`

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:plan-deposit}}
```

### `tryPrepare(p) → Promise<{ ok: true; value: DepositPlan } | { ok: false; error }>`

Result-style `prepare`.

### `create(p: DepositParams) → Promise<DepositHandle<TransactionRequest>>`

Prepares and **executes** all required L1 steps.
Returns a handle with the L1 transaction hash and per-step hashes.

**Returns:** `DepositHandle`

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:handle}}
```

> [!WARNING]
> If any step reverts, `create()` throws a typed error.
> Prefer `tryCreate()` to avoid exceptions.

### `tryCreate(p) → Promise<{ ok: true; value: DepositHandle } | { ok: false; error }>`

Result-style `create`.

### `status(handleOrHash) → Promise<DepositStatus>`

Resolve the current phase for a deposit.
Accepts either the `DepositHandle` from `create()` or a raw L1 transaction hash.

**Phases**

| Phase         | Meaning                                   |
| ------------- | ----------------------------------------- |
| `UNKNOWN`     | No L1 hash provided                       |
| `L1_PENDING`  | L1 receipt not yet found                  |
| `L1_INCLUDED` | Included on L1; L2 hash not derivable yet |
| `L2_PENDING`  | L2 hash known; waiting for L2 receipt     |
| `L2_EXECUTED` | L2 receipt found with `status === 1`      |
| `L2_FAILED`   | L2 receipt found with `status !== 1`      |

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:status}}
```

### `wait(handleOrHash, { for: 'l1' | 'l2' }) → Promise<TransactionReceipt | null>`

Block until the specified checkpoint.

* `{ for: 'l1' }` → L1 receipt (or `null` if no L1 hash)
* `{ for: 'l2' }` → L2 receipt after canonical execution (or `null` if no L1 hash)

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:wait}}
```

### `tryWait(handleOrHash, opts) → Result<TransactionReceipt>`

Result-style `wait`.

## End-to-End Examples

### ETH Deposit (Typical)

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:create-eth-deposit}}
```

### ERC-20 Deposit

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:token-address}}
{{#include ../../../snippets/ethers/reference/deposits.test.ts:create-token-deposit}}
```

---

## Types (Overview)

### Deposit Params

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:params-type}}
```

### Deposit Quote

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:quote-type}}
```

### Deposit Plan

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:plan-type}}
```

### Deposit Waitable

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:wait-type}}
```

### Deposit Status

```ts
{{#include ../../../snippets/ethers/reference/deposits.test.ts:status-type}}
```

> [!TIP]
> Prefer the `try*` variants if you want to avoid exceptions and work with structured result objects.

---

## Notes & Pitfalls

* **ETH sentinel:** Use the canonical `0x…00` address when passing ETH as `token`.
* **Receipt timing:** `wait({ for: 'l2' })` resolves only after canonical L2 execution — it can take longer than L1 inclusion.
