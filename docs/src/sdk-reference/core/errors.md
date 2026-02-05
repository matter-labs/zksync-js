# Error Model

Typed, structured errors with a stable envelope across **viem** and **ethers** adapters.

## Overview

All SDK operations either:

1. **Throw** a `ZKsyncError` whose `.envelope` gives you a structured, stable payload, or
2. Return a **result object** from the `try*` variants:
   `{ ok: true, value } | { ok: false, error }`

This is consistent across both **ethers** and **viem** adapters.

> [!TIP]
> Prefer the `try*` variants when you want to avoid exceptions and branch on success/failure.

## What Gets Thrown

When the SDK throws, it throws an instance of `ZKsyncError`.
Use `isZKsyncError(e)` to narrow and read the **error envelope**.

```ts
{{#include ../../../snippets/core/errors.test.ts:error-import}}

{{#include ../../../snippets/core/errors.test.ts:zksync-error}}
```

## Envelope Shape

**Instance Type**

```ts
'ZKsyncError'
```

### `ZKsyncError.envelope: ErrorEnvelope`

```ts
{{#include ../../../snippets/core/errors.test.ts:envelope-type}}
```

### Categories (When to Expect Them)

| Type           | Meaning (how to react)                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- |
| `VALIDATION`   | Inputs are invalid — fix parameters and retry.                                           |
| `STATE`        | Operation not possible **yet** (e.g., not finalizable). Wait or change state.            |
| `EXECUTION`    | A send/revert happened (tx reverted or couldn’t be confirmed). Inspect `revert`/`cause`. |
| `RPC`          | Provider/transport failure. Retry with backoff or check infra.                           |
| `VERIFICATION` | Proof/verification issue (e.g., unable to find deposit log).                             |
| `CONTRACT`     | Contract read/encode/allowance failed. Check addresses & ABI.                            |
| `INTERNAL`     | SDK internal issue — report with `operation` and `selector`.                             |

## Result Style (`try*`) Helpers

Every resource method has a `try*` sibling that never throws and returns a `TryResult<T>`.

```ts
{{#include ../../../snippets/core/errors.test.ts:try-create}}
```

This is especially useful for **UI flows** where you want inline validation/state messages without `try/catch`.

## Revert Details (When Transactions Fail)

If the provider exposes revert data, the adapters decode common error types and ABIs so you can branch on them:

```ts
{{#include ../../../snippets/core/errors.test.ts:revert-details}}
```

**Notes**

* The SDK always includes the **4-byte selector**.
* `name` / `args` appear when decodable; coverage will expand over time.
* A revert implying “not ready yet” appears as a `STATE` error with a clear message.

## Ethers & Viem Examples

<details>
<summary><strong>Ethers</strong></summary>

```ts
{{#include ../../../snippets/ethers/overview/adapter-basic.test.ts:ethers-basic-imports}}
{{#include ../../../snippets/core/errors.test.ts:error-import}}

{{#include ../../../snippets/ethers/overview/adapter-basic.test.ts:init-ethers-adapter}}

{{#include ../../../snippets/core/errors.test.ts:envelope-error}}
```

</details>

<details>
<summary><strong>Viem</strong></summary>

```ts
{{#include ../../../snippets/ethers/overview/adapter.test.ts:ethers-adapter-imports}}
{{#include ../../../snippets/core/errors.test.ts:error-import}}

{{#include ../../../snippets/ethers/overview/adapter-basic.test.ts:init-ethers-adapter}}

{{#include ../../../snippets/core/errors.test.ts:envelope-error}}
```

</details>

## Logging & Observability

* `err.toJSON()` → returns a safe, structured object suitable for telemetry.
* Logging `err` directly prints a compact summary: category, operation, context, optional revert/cause.

> [!WARNING]
> Avoid parsing `err.message` for logic — use typed fields on `err.envelope` instead.
