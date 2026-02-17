# Deposits

L1 → L2 deposits for ETH and ERC-20 tokens with quote, prepare, create, status, and wait helpers using the **Viem adapter**.

---

## At a Glance

* **Resource:** `sdk.deposits`
* **Common flow:** `quote → create → wait({ for: 'l2' })`
* **Auto-routing:** ETH vs ERC-20 and base-token vs non-base handled automatically
* **Error style:** Throwing methods (`quote`, `prepare`, `create`, `wait`) + safe variants (`tryQuote`, `tryPrepare`, `tryCreate`, `tryWait`)
* **Token mapping:** Use `sdk.tokens` for L1⇄L2 token lookups and assetIds if you need token metadata ahead of time.

## Import

```ts
{{#include ../../../snippets/viem/reference/deposits.test.ts:imports}}

{{#include ../../../snippets/viem/reference/deposits.test.ts:init-sdk}}
```

---

## Quick Start

Deposit **0.1 ETH** from L1 → L2 and wait for **L2 execution**:

```ts
{{#include ../../../snippets/viem/reference/deposits.test.ts:create-deposit}}
```

> [!TIP]
> For UX that never throws, use the `try*` variants and branch on `ok`.

---

## Route Selection (Automatic)

| Route           | Meaning                                  |
| --------------- | ---------------------------------------- |
| `eth-base`      | ETH when L2 base token **is ETH**        |
| `eth-nonbase`   | ETH when L2 base token **≠ ETH**         |
| `erc20-base`    | ERC-20 that **is** the L2 base token     |
| `erc20-nonbase` | ERC-20 that **is not** the L2 base token |

You **do not** pass a route; it’s derived automatically from chain metadata + `token`.

## Method Reference

### `quote(p: DepositParams) → Promise<DepositQuote>`

Estimate the deposit operation (route, approvals, gas hints). Does **not** send transactions.

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
{{#include ../../../snippets/viem/reference/deposits.test.ts:quote-deposit}}
```

> [!TIP]
> If `summary.approvalsNeeded` is non-empty (ERC-20), `create()` will automatically include those steps.

### `tryQuote(p) → Promise<{ ok: true; value: DepositQuote } | { ok: false; error }>`

Result-style `quote`.

### `prepare(p: DepositParams) → Promise<DepositPlan<TransactionRequest>>`

Build a plan (ordered steps + unsigned txs) without sending.

**Returns:** `DepositPlan`

```ts
{{#include ../../../snippets/viem/reference/deposits.test.ts:plan-deposit}}
```

### `tryPrepare(p) → Promise<{ ok: true; value: DepositPlan } | { ok: false; error }>`

Result-style `prepare`.

### `create(p: DepositParams) → Promise<DepositHandle<TransactionRequest>>`

Prepares and **executes** all required L1 steps.
Returns a handle with the L1 tx hash and per-step hashes.

**Returns:** `DepositHandle`

```ts
{{#include ../../../snippets/viem/reference/deposits.test.ts:handle}}
```

> [!WARNING]
> If any step reverts, `create()` throws a typed error. Prefer `tryCreate()` to avoid exceptions.

### `tryCreate(p) → Promise<{ ok: true; value: DepositHandle } | { ok: false; error }>`

Result-style `create`.

### `status(handleOrHash) → Promise<DepositStatus>`

Resolve current phase for a deposit.
Accepts either a `DepositHandle` or a raw L1 tx hash.

| Phase         | Meaning                                   |
| ------------- | ----------------------------------------- |
| `UNKNOWN`     | No L1 hash provided                       |
| `L1_PENDING`  | L1 receipt not yet found                  |
| `L1_INCLUDED` | Included on L1; L2 hash not derivable yet |
| `L2_PENDING`  | L2 hash known; waiting for L2 receipt     |
| `L2_EXECUTED` | L2 receipt found with `status === 1`      |
| `L2_FAILED`   | L2 receipt found with `status !== 1`      |

```ts
{{#include ../../../snippets/viem/reference/deposits.test.ts:status}}
```

### `wait(handleOrHash, { for: 'l1' | 'l2' }) → Promise<TransactionReceipt | null>`

Block until a checkpoint is reached.

* `{ for: 'l1' }` → L1 receipt (or `null` if no L1 hash)
* `{ for: 'l2' }` → L2 receipt after canonical execution (or `null` if no L1 hash)

```ts
{{#include ../../../snippets/viem/reference/deposits.test.ts:wait}}
```

### `tryWait(handleOrHash, opts) → Result<TransactionReceipt>`

Result-style `wait`.

---

## End-to-End Examples

### ETH Deposit (Typical)

```ts
{{#include ../../../snippets/viem/reference/deposits.test.ts:create-eth-deposit}}
```

### ERC-20 Deposit (with Automatic Approvals)

```ts
{{#include ../../../snippets/viem/reference/deposits.test.ts:token-address}}
{{#include ../../../snippets/viem/reference/deposits.test.ts:create-token-deposit}}
```

---

## Utility Helpers

### `getL2TransactionHashFromLogs(logs) → Hex | null`

Extracts the L2 transaction hash from L1 logs emitted by `Bridgehub` during deposit. Returns `null` if not found.

```ts
import { getL2TransactionHashFromLogs } from '@matterlabs/zksync-js/viem';

const l1Receipt = await client.l1.waitForTransactionReceipt({ hash: l1TxHash });
const l2TxHash = getL2TransactionHashFromLogs(l1Receipt.logs);
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
> Prefer the `try*` variants to avoid exceptions and work with structured result objects.

---

## Notes & Pitfalls

* **ETH sentinel:** Always use the canonical `0x…00` address when passing ETH as `token`.
* **Receipts timing:** `wait({ for: 'l2' })` resolves after canonical L2 execution — may take longer than L1 inclusion.
* **Gas hints:** `suggestedL2GasLimit` and `gasPerPubdata` are informational; advanced users can override via the prepared plan.
