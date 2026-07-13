# Interop (ethers)

A fast path to execute **cross-chain actions** between ZKsync L2 chains using the **ethers** adapter.

Interop is a **three-step process**:

1. **Create** the bundle on the source L2.
2. **Wait** until the bundle proof is available on the destination.
3. **Finalize** to verify and execute every action atomically on the destination L2.

## Prerequisites

- A funded **source L2** account (gas + action value + interop fee).
- A funded **destination L2** account for the finalization transaction.
- RPC URLs: `L1_RPC_URL`, `SRC_L2_RPC_URL`, `DST_L2_RPC_URL`.
- Installed: `@matterlabs/zksync-js` + `ethers`.

---

## Setup

Interop uses the source and destination providers directly. No additional gateway configuration is required.

```ts
{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:imports}}
```

---

## Parameters (quick reference)

| Param         | Required | Meaning                                               |
| ------------- | -------- | ----------------------------------------------------- |
| `actions`     | Yes      | Ordered list of actions to execute on destination     |
| `execution`   | No       | Restrict execution to a specific address              |
| `fee`         | No       | `{ useFixed: true }` to use fixed ZK fee instead of dynamic base-token fee |
| `txOverrides` | No       | Gas overrides for the source L2 transaction           |

### Action types

| Type          | Fields                             | Effect on destination                   |
| ------------- | ---------------------------------- | --------------------------------------- |
| `sendErc20`   | `token`, `to`, `amount`            | Transfer ERC-20 tokens to `to`          |
| `call`        | `to`, `data`, `value?`             | Execute arbitrary contract call         |

> ERC-20 actions may require an L2 `approve()` on the source chain. **`quote()`** surfaces required approvals.

---

## Fast path (one-shot)

```ts
{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:imports}}

{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:main}}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- `create()` sends the interop bundle on **source L2**.
- `wait()` blocks until the bundle proof is available on destination.
- `finalize()` atomically verifies and executes the bundle on **destination L2**.

## Inspect & customize (quote → prepare → create)

**1. Quote (no side-effects)**
Preview fees, approvals, and route before sending anything.

```ts
{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:quote}}
```

**2. Prepare (build txs, don't send)**
Get `TransactionRequest[]` for signing or custom gas management.

```ts
{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:prepare}}
```

**3. Create (send)**
Executes all required source-chain steps and waits for receipts.

```ts
{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:create}}
```

## Track progress (status vs wait)

**Non-blocking snapshot**

```ts
{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:status}}
```

**Block until ready for finalization**

```ts
{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:wait}}
```

## Atomic finalization (required step)

```ts
{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:finalize}}
```

> [!INFO]
> You can also pass the `handle` (or raw `l2SrcTxHash`) directly to `finalize()`.
> It will call `wait()` internally before calling `executeBundle` on the destination. Partial unbundling is not exposed by the intent API.

## Error handling patterns

**Exceptions**

```ts
{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:try-catch-create}}
```

**No-throw style**

Every method has a `try*` variant (e.g. `tryQuote`, `tryCreate`, `tryWait`, `tryFinalize`).
These never throw—so you don't need a `try/catch`. Instead they return:

- `{ ok: true, value: ... }` on success
- `{ ok: false, error: ... }` on failure

This is useful for **UI flows** or **services** where you want explicit control over errors.

```ts
{{#include ../../../snippets/ethers/guides/interop-guide.test.ts:tryCreate}}
```

## Troubleshooting

- **Stuck at `SENT`:** The L2→L1 proof may not be generated yet; `wait()` polls automatically.
- **`FAILED` phase:** Inspect `status.dstExecTxHash` for the destination revert; check the action calldata and value.
- **Finalize reverts:** Ensure the destination L2 account has enough gas. The bundle may have already been executed — check `status()` first.

---

## See also

- [Status vs Wait](../../overview/status-vs-wait.md)
- [Interop SDK Reference (ethers)](../../sdk-reference/ethers/interop.md)
