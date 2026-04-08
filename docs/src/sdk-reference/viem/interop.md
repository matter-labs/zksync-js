# Interop

Cross-chain execution between ZKsync L2 chains: send native tokens, ERC-20 tokens, or arbitrary contract calls from a source L2 to a destination L2 using the **viem adapter**.

---

## At a Glance

* **Resource:** `sdk.interop`
* **Typical flow:** `create → wait → finalize`
* **Inspection flow:** `quote → prepare → create → status → wait → finalize`
* **Error style:** Throwing methods (`quote`, `prepare`, `create`, `status`, `wait`, `finalize`, `getInteropRoot`, `verifyBundle`) + safe variants (`tryQuote`, `tryPrepare`, `tryCreate`, `tryWait`, `tryFinalize`)
* **SDK config:** Requires `interop: { gwChain }` — see [Import](#import)

## Import

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:imports}}

{{#include ../../../snippets/viem/reference/interop.test.ts:init-sdk}}
```

> [!INFO]
> The `gwChain` option is **required** for interop. It can be a RPC URL string or a live `PublicClient`.
> It is used to poll the gateway chain for interop root availability during `wait()`.

## Quick Start

Send **0.001 ETH** from source L2 to destination L2:

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:quick-start}}
```

> [!TIP]
> For UX that never throws, use the `try*` variants and branch on `ok`.

---

## Method Reference

### `quote(dstChain, params) → Promise<InteropQuote>`

Estimate the operation (route, approvals, fee). Does **not** send transactions.

**Parameters**

| Name                  | Type              | Required | Description                                                          |
| --------------------- | ----------------- | -------- | -------------------------------------------------------------------- |
| `dstChain`            | `ChainRef`        | ✅        | Destination chain — URL string or `PublicClient`.                    |
| `params.actions`      | `InteropAction[]` | ✅        | Ordered list of actions to execute on the destination chain.         |
| `params.execution`    | `{ only: Address }` | ❌      | Restrict who can execute the bundle on destination.                  |
| `params.unbundling`   | `{ by: Address }` | ❌       | Allow a specific address to unbundle actions individually.           |
| `params.fee`          | `{ useFixed: boolean }` | ❌  | Use fixed ZK fee (`true`) instead of dynamic base-token fee.         |
| `params.txOverrides`  | `TxOverrides`     | ❌        | Gas overrides for the source L2 transaction.                         |

**Returns:** `InteropQuote`

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:quote}}
```

> [!TIP]
> If `approvalsNeeded` is non-empty (ERC-20 actions), `create()` will include approval steps automatically.

### `tryQuote(dstChain, params) → Promise<{ ok: true; value: InteropQuote } | { ok: false; error }>`

Result-style `quote`.

### `prepare(dstChain, params) → Promise<InteropPlan<TransactionRequest>>`

Build the plan (ordered steps + unsigned transactions) without sending.

**Returns:** `InteropPlan`

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:prepare}}
```

### `tryPrepare(dstChain, params) → Promise<{ ok: true; value: InteropPlan } | { ok: false; error }>`

Result-style `prepare`.

### `create(dstChain, params) → Promise<InteropHandle<TransactionRequest>>`

Prepares and **executes** all required source-chain steps.
Waits for each step receipt before returning.

**Returns:** `InteropHandle`

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:handle}}
```

> [!WARNING]
> If any step reverts, `create()` throws a typed error.
> Prefer `tryCreate()` to avoid exceptions.

### `tryCreate(dstChain, params) → Promise<{ ok: true; value: InteropHandle } | { ok: false; error }>`

Result-style `create`.

### `status(dstChain, waitable, opts?) → Promise<InteropStatus>`

Non-blocking lifecycle inspection. Returns the current phase.
Accepts either an `InteropHandle` or a raw source L2 tx hash.

**Phases**

| Phase       | Meaning                                              |
| ----------- | ---------------------------------------------------- |
| `SENT`      | Bundle sent on source chain                          |
| `VERIFIED`  | Bundle verified, ready for execution on destination  |
| `EXECUTED`  | All actions executed on destination                  |
| `UNBUNDLED` | Actions selectively executed or cancelled            |
| `FAILED`    | Execution reverted or invalid                        |
| `UNKNOWN`   | Status cannot be determined                          |

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:status}}
```

### `wait(dstChain, waitable, opts?) → Promise<InteropFinalizationInfo>`

Block until the bundle proof is available on the destination chain.
Returns the `InteropFinalizationInfo` needed to call `finalize()`.

* `opts.pollMs` — polling interval in ms (default: 5000)
* `opts.timeoutMs` — max wait time in ms (throws on timeout)

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:wait}}
```

### `tryWait(dstChain, waitable, opts?) → Promise<{ ok: true; value: InteropFinalizationInfo } | { ok: false; error }>`

Result-style `wait`.

### `finalize(dstChain, h, opts?, txOverrides?) → Promise<InteropFinalizationResult>`

Execute the bundle on the **destination chain**. Accepts either:
- `InteropFinalizationInfo` (returned by `wait()`) — executes immediately
- `InteropHandle` or raw tx hash — calls `wait()` internally first

**Parameters**

| Name          | Type               | Required | Description                                                        |
| ------------- | ------------------ | -------- | ------------------------------------------------------------------ |
| `dstChain`    | `ChainRef`         | ✅        | Destination chain — URL string or `PublicClient`.                  |
| `h`           | `InteropFinalizationInfo \| InteropWaitable` | ✅ | Finalization info or a waitable handle/hash.    |
| `opts`        | `LogsQueryOptions` | ❌        | Options for log queries used to check bundle status.               |
| `txOverrides` | `TxGasOverrides`   | ❌        | Gas overrides for the `executeBundle` transaction on destination.  |

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:finalize}}
```

To override gas on the destination `executeBundle` transaction:

```ts
await sdk.interop.finalize(l2Destination, finalizationInfo, undefined, {
  gasLimit: 5_000_000n,
  maxFeePerGas: 200_000_000n,
});
```

> [!INFO]
> `finalize()` sends a transaction on the **destination L2**, not on L1.
> Use `txOverrides` if the destination chain requires a manual gas limit (e.g. when the interop handler calls a receiver contract that may consume significant gas).

### `tryFinalize(dstChain, h, opts?, txOverrides?) → Promise<{ ok: true; value: InteropFinalizationResult } | { ok: false; error }>`

Result-style `finalize`. Accepts the same `txOverrides` parameter.

### `getInteropRoot(dstChain, rootChainId, batchNumber) → Promise<Hex>`

Read the interop root stored on the destination chain for a given source chain and batch number. Useful for low-level inspection or building custom proof-verification flows.

**Parameters**

| Name            | Type       | Description                                      |
| --------------- | ---------- | ------------------------------------------------ |
| `dstChain`      | `ChainRef` | Destination chain — URL string or `PublicClient`. |
| `rootChainId`   | `bigint`   | Chain ID of the source (root) chain.             |
| `batchNumber`   | `bigint`   | Batch number on the source chain.                |

**Returns:** `Promise<Hex>` — the raw interop root hash, or zero bytes if not yet available.

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:get-interop-root}}
```

### `verifyBundle(dstChain, h) → Promise<InteropFinalizationResult>`

Submit a `verifyBundle` transaction on the destination chain. Unlike `finalize()`, this calls the handler's verify path, which records the bundle as verified without executing actions.

Accepts either:
- `InteropFinalizationInfo` (returned by `wait()`) — submits immediately
- `InteropHandle` or raw tx hash — calls `wait()` internally first

**Returns:** `InteropFinalizationResult`

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:verify-bundle}}
```

> [!INFO]
> `verifyBundle()` is a **power-user** method. Most integrations should use `finalize()` instead.
> Use this when you need to separate the verification and execution steps.

---

## End-to-End Examples

### ERC-20 Transfer

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:e2e-erc20}}
```

### Remote Contract Call

```ts
{{#include ../../../snippets/viem/reference/interop.test.ts:e2e-call}}
```

---

## Types (Overview)

### Interop Params

```ts
{{#include ../../../snippets/ethers/reference/interop.test.ts:params-type}}
```

### Interop Quote

```ts
{{#include ../../../snippets/ethers/reference/interop.test.ts:quote-type}}
```

### Interop Plan

```ts
{{#include ../../../snippets/ethers/reference/interop.test.ts:plan-type}}
```

### Interop Handle

```ts
{{#include ../../../snippets/ethers/reference/interop.test.ts:handle-type}}
```

### Interop Status

```ts
{{#include ../../../snippets/ethers/reference/interop.test.ts:status-type}}
```

### Interop Finalization

```ts
{{#include ../../../snippets/ethers/reference/interop.test.ts:finalization-type}}
```

> [!TIP]
> Prefer the `try*` variants to avoid exceptions and work with structured result objects.

---

## Notes & Pitfalls

* **`gwChain` is required:** Forgetting it causes a `STATE` error on the first interop call.
* **`dstChain` first:** All interop methods take the destination chain as the **first** argument — unlike deposits/withdrawals.
* **Finalization is on destination:** `finalize()` sends a transaction on the **destination L2**, not on L1. Use `txOverrides` to set a custom gas limit when the receiver contract consumes significant gas.
* **`wait()` can take minutes:** It polls until the L2→L1 proof is generated and the interop root is available on destination. Use `timeoutMs` to bound long waits.
* **ERC-20 approvals:** If `approvalsNeeded` is non-empty, `create()` automatically sends approval transactions first.
* **ERC-20 tokens must be migrated to Gateway:** The SDK does **not** migrate tokens automatically. If the ERC-20 token has not been migrated to the Gateway chain, `create()` will throw an error. Migrate the token first before using it in an interop transfer.
* **Multiple actions:** Actions are atomic — all succeed or the bundle fails. Use `unbundling` to allow partial execution.
