# Status vs Wait

Snapshot progress with `status(...)` or block until a checkpoint with `wait(..., { for })` for deposits and withdrawals.

The SDK exposes two complementary ways to track progress:

* **`status(...)`** — returns a **non-blocking snapshot** of where an operation is.
* **`wait(..., { for })`** — **blocks/polls** until a specified checkpoint is reached.

Both apply to **deposits** and **withdrawals**.
Use `status(...)` for UI refreshes; use `wait(...)` when you need to gate logic on inclusion/finality.

> [!NOTE]
> You can pass **either** a handle returned from `create(...)` **or** a raw transaction hash.

## Withdrawals

### `withdrawals.status(h | l2TxHash): Promise<WithdrawalStatus>`

**Input**

* `h`: a `WithdrawalWaitable` (e.g., from `create`) **or** the L2 transaction hash `Hex`.

**Phases**

| Phase               | Meaning                                           |
| ------------------- | ------------------------------------------------- |
| `UNKNOWN`           | Handle doesn’t contain an L2 hash yet.            |
| `L2_PENDING`        | L2 transaction not yet included.                  |
| `PENDING`           | L2 included, **not** yet ready to finalize on L1. |
| `READY_TO_FINALIZE` | Finalization on L1 would succeed now.             |
| `FINALIZED`         | Finalized on L1; funds released.                  |

**Notes**

* No L2 receipt ⇒ `L2_PENDING`
* Finalization key derivable but not ready ⇒ `PENDING`
* Already finalized ⇒ `FINALIZED`

<details>
<summary><code>withdrawals-status.ts</code></summary>

```ts
{{#include ../../snippets/viem/overview/adapter.test.ts:withdraw-status}}
```

</details>

### `withdrawals.wait(h | l2TxHash, { for, pollMs?, timeoutMs? })`

**Targets**

| Target                 | Resolves with                                                               |        |
| ---------------------- | --------------------------------------------------------------------------- | ------ |
| `{ for: 'l2' }`        | **L2 receipt** (`TransactionReceipt                                         | null`) |
| `{ for: 'ready' }`     | **`null`** when finalization becomes possible                               |        |
| `{ for: 'finalized' }` | **L1 receipt** when finalized, or `null` if finalized but receipt not found |        |

**Behavior**

* If the handle has **no L2 hash**, returns `null` immediately.
* Default polling interval: **5500 ms** (override with `pollMs`).
* `timeoutMs` → returns `null` on deadline.

<details>
<summary><code>withdrawals-wait.ts</code></summary>

```ts
{{#include ../../snippets/viem/overview/adapter.test.ts:withdraw-wait}}
```

</details>

> [!TIP]
> Building a UI? Use `status(...)` to paint the current phase and enable/disable the **Finalize** button when the phase is `READY_TO_FINALIZE`.

## Deposits

### `deposits.status(h | l1TxHash): Promise<DepositStatus>`

**Input**

* `h`: a `DepositWaitable` (from `create`) **or** L1 transaction hash `Hex`.

**Phases**

| Phase         | Meaning                                           |
| ------------- | ------------------------------------------------- |
| `UNKNOWN`     | No L1 hash present on the handle.                 |
| `L1_PENDING`  | L1 receipt missing.                               |
| `L1_INCLUDED` | L1 included; L2 hash not yet derivable from logs. |
| `L2_PENDING`  | L2 hash known but L2 receipt missing.             |
| `L2_EXECUTED` | L2 receipt present with `status === 1`.           |
| `L2_FAILED`   | L2 receipt present with `status !== 1`.           |

<details>
<summary><code>deposits-status.ts</code></summary>

```ts
{{#include ../../snippets/viem/overview/adapter.test.ts:deposit-status}}
```

</details>

### `deposits.wait(h | l1TxHash, { for: 'l1' | 'l2' })`

**Targets**

| Target          | Resolves with                                                       |
| --------------- | ------------------------------------------------------------------- |
| `{ for: 'l1' }` | **L1 receipt** or `null`                                            |
| `{ for: 'l2' }` | **L2 receipt** or `null` (waits L1 inclusion **then** L2 execution) |

<details>
<summary><code>deposits-wait.ts</code></summary>

```ts
{{#include ../../snippets/viem/overview/adapter.test.ts:deposit-wait}}
```

</details>

> [!NOTE]
> `wait(..., { for: 'l2' })` waits for both **L1 inclusion** and **canonical L2 execution**.

## Practical Patterns

### Pick the Right Tool

* **Use `status(...)`** for **poll-less UI refreshes** (e.g., on page focus or controlled intervals).
* **Use `wait(...)`** for **workflow gating** (scripts, jobs, or “continue when X happens”).

### Timeouts & Polling

<details>
<summary><code>polling.ts</code></summary>

```ts
{{#include ../../snippets/viem/overview/adapter.test.ts:withdraw-poll}}
```

</details>

### Error Handling

* Network hiccup while fetching receipts ⇒ throws `ZKsyncError` of kind **`RPC`**.
* Internal decode issue ⇒ throws `ZKsyncError` of kind **`INTERNAL`**.

Prefer **no-throw** variants if you want explicit flow control:

<details>
<summary><code>no-throw.ts</code></summary>

```ts
{{#include ../../snippets/viem/overview/adapter.test.ts:withdraw-try-wait}}
```

</details>

---

## Tips & Edge Cases

* **Handles vs hashes:** Passing a handle without the relevant hash yields `UNKNOWN` / `null`. If you already have a hash, pass it directly.
* **Finalization windows:** For withdrawals, `READY_TO_FINALIZE` may take a while. Use `status(...)` for responsive UI and reserve `wait(..., { for: 'finalized' })` for blocking logic.
* **Retries:** If a `wait` returns `null` because of `timeoutMs`, safely call `status(...)` to decide whether to retry or surface user guidance.
