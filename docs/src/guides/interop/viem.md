# Interop (viem)

A fast path to execute **cross-chain actions** between ZKsync L2 chains using the **viem** adapter.

Interop is a **three-step process**:

1. **Create** the bundle on the source L2.
2. **Wait** until the bundle proof is available on the destination.
3. **Finalize** to execute the actions on the destination L2.

## Prerequisites

- A funded **source L2** account (gas + action value + interop fee).
- A funded **destination L2** account for the finalization transaction.
- RPC URLs: `L1_RPC_URL`, `GW_RPC_URL`, `SRC_L2_RPC_URL`, `DST_L2_RPC_URL`.
- Installed: `@matterlabs/zksync-js` + `viem`.
- SDK initialized with `interop: { gwChain }` (see [Setup](#setup)).

---

## Setup

Interop requires the SDK to know the **gateway chain** RPC, used to poll for interop root availability.

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:imports}}
```

---

## Parameters (quick reference)

| Param         | Required | Meaning                                               |
| ------------- | -------- | ----------------------------------------------------- |
| `actions`     | Yes      | Ordered list of actions to execute on destination     |
| `execution`   | No       | Restrict execution to a specific address              |
| `unbundling`  | No       | Specify who can unbundle actions individually         |
| `fee`         | No       | `{ useFixed: true }` to use fixed ZK fee instead of dynamic base-token fee |
| `txOverrides` | No       | Gas overrides for the source L2 transaction           |

### Action types

| Type          | Fields                             | Effect on destination                   |
| ------------- | ---------------------------------- | --------------------------------------- |
| `sendNative`  | `to`, `amount`                     | Transfer native token (ETH) to `to`     |
| `sendErc20`   | `token`, `to`, `amount`            | Transfer ERC-20 tokens to `to`          |
| `call`        | `to`, `data`, `value?`             | Execute arbitrary contract call         |

> ERC-20 actions may require an L2 `approve()` on the source chain. **`quote()`** surfaces required approvals.

> [!WARNING]
> The ERC-20 token must already be **migrated to the Gateway** chain before it can be used in an interop transfer. The SDK does not perform this migration automatically — if the token is not migrated, `create()` will throw an error.

---

## Fast path (one-shot)

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:imports}}

{{#include ../../../snippets/viem/guides/interop-guide.test.ts:main}}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- `create()` sends the interop bundle on **source L2**.
- `wait()` blocks until the bundle proof is available on destination.
- `finalize()` executes the bundle on **destination L2**.

## Inspect & customize (quote → prepare → create)

**1. Quote (no side-effects)**
Preview fees, approvals, and route before sending anything.

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:quote}}
```

**2. Prepare (build txs, don't send)**
Get the transaction request objects for signing or custom gas management.

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:prepare}}
```

**3. Create (send)**
Executes all required source-chain steps and waits for receipts.

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:create}}
```

## Track progress (status vs wait)

**Non-blocking snapshot**

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:status}}
```

**Block until ready for finalization**

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:wait}}
```

## Finalization (required step)

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:finalize}}
```

> [!INFO]
> You can also pass the `handle` (or raw `l2SrcTxHash`) directly to `finalize()`.
> It will call `wait()` internally before executing on destination.

## Error handling patterns

**Exceptions**

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:try-catch-create}}
```

**No-throw style**

Every method has a `try*` variant (e.g. `tryQuote`, `tryCreate`, `tryWait`, `tryFinalize`).
These never throw—so you don't need a `try/catch`. Instead they return:

- `{ ok: true, value: ... }` on success
- `{ ok: false, error: ... }` on failure

This is useful for **UI flows** or **services** where you want explicit control over errors.

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:tryCreate}}
```

## Troubleshooting

- **`Interop is not configured`:** Pass `interop: { gwChain: GW_RPC }` when creating the SDK.
- **Stuck at `SENT`:** The L2→L1 proof may not be generated yet; `wait()` polls automatically.
- **`FAILED` phase:** Inspect `status.dstExecTxHash` for the destination revert; check the action calldata and value.
- **Finalize reverts:** Ensure the destination L2 account has enough gas. The bundle may have already been executed — check `status()` first.

---

## See also

- [Status vs Wait](../../overview/status-vs-wait.md)
- [Interop SDK Reference (viem)](../../sdk-reference/viem/interop.md)
