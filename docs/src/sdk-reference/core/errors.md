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
import { isZKsyncError } from '@matter-labs/zksync-js/core';

try {
  const handle = await sdk.deposits.create(params);
} catch (e) {
  if (isZKsyncError(e)) {
    const err = e; // type-narrowed
    const { type, resource, operation, message, context, revert } = err.envelope;

    switch (type) {
      case 'VALIDATION':
      case 'STATE':
        // user/action fixable (bad input, not-ready, etc.)
        break;
      case 'EXECUTION':
      case 'RPC':
        // network/tx/provider issues
        break;
    }

    console.error(JSON.stringify(err.toJSON())); // structured log
  } else {
    throw e; // non-SDK error
  }
}
```

## Envelope Shape

**Instance Type**

```ts
'ZKsyncError'
```

### `ZKsyncError.envelope: ErrorEnvelope`

```ts
type ErrorEnvelope = {
  /** Resource surface that raised the error. */
  resource: 'deposits' | 'withdrawals' | 'withdrawal-finalization' | 'helpers' | 'zksrpc';

  /** Specific operation, e.g. "withdrawals.finalize" or "deposits.create". */
  operation: string;

  /** Broad category (see table below). */
  type: 'VALIDATION' | 'STATE' | 'EXECUTION' | 'RPC' | 'INTERNAL' | 'VERIFICATION' | 'CONTRACT';

  /** Stable, human-readable message for developers. */
  message: string;

  /** Optional contextual fields (tx hash, nonce, step key, etc.). */
  context?: Record<string, unknown>;

  /** If the error is a contract revert, adapters include decoded info when available. */
  revert?: {
    selector: `0x${string}`; // 4-byte selector
    name?: string; // Decoded Solidity error name
    args?: unknown[]; // Decoded args
    contract?: string; // Best-effort contract label
    fn?: string; // Best-effort function label
  };

  /** Originating error (provider/transport/etc.), sanitized for safe logging. */
  cause?: unknown;
};
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
const res = await sdk.withdrawals.tryCreate(params);
if (!res.ok) {
  // res.error is a ZKsyncError
  console.warn(res.error.envelope.message, res.error.envelope.operation);
} else {
  console.log('l2TxHash', res.value.l2TxHash);
}
```

This is especially useful for **UI flows** where you want inline validation/state messages without `try/catch`.

## Revert Details (When Transactions Fail)

If the provider exposes revert data, the adapters decode common error types and ABIs so you can branch on them:

```ts
try {
  await sdk.withdrawals.finalize(l2TxHash);
} catch (e) {
  if (isZKsyncError(e) && e.envelope.revert) {
    const { selector, name, args } = e.envelope.revert;
    // e.g., name === 'InvalidProof' or 'TransferAmountExceedsBalance'
  }
}
```

**Notes**

* The SDK always includes the **4-byte selector**.
* `name` / `args` appear when decodable; coverage will expand over time.
* A revert implying “not ready yet” appears as a `STATE` error with a clear message.

## Ethers & Viem Examples

<details>
<summary><strong>Ethers</strong></summary>

```ts
import { JsonRpcProvider, Wallet } from 'ethers';
import { createEthersClient, createEthersSdk } from '@matter-labs/zksync-js/ethers';
import { isZKsyncError } from '@matter-labs/zksync-js/core';

const l1 = new JsonRpcProvider(process.env.ETH_RPC!);
const l2 = new JsonRpcProvider(process.env.ZKSYNC_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);

const res = await sdk.deposits.tryCreate({ token, amount, to });
if (!res.ok) {
  console.error(res.error.envelope); // structured envelope
}
```

</details>

<details>
<summary><strong>Viem</strong></summary>

```ts
import { createPublicClient, http, createWalletClient, privateKeyToAccount } from 'viem';
import { createViemClient, createViemSdk } from '@matter-labs/zksync-js/viem';
import { isZKsyncError } from '@matter-labs/zksync-js/core';

const account = privateKeyToAccount(process.env.PRIVATE_KEY! as `0x${string}`);
const l1 = createPublicClient({ transport: http(process.env.ETH_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.ZKSYNC_RPC!) });
const l1Wallet = createWalletClient({ account, transport: http(process.env.ETH_RPC!) });
const l2Wallet = createWalletClient({ account, transport: http(process.env.ZKSYNC_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
const sdk = createViemSdk(client);

try {
  await sdk.withdrawals.finalize(l2TxHash);
} catch (e) {
  if (isZKsyncError(e)) {
    console.log(e.envelope.message, e.envelope.operation);
  } else {
    throw e;
  }
}
```

</details>

## Logging & Observability

* `err.toJSON()` → returns a safe, structured object suitable for telemetry.
* Logging `err` directly prints a compact summary: category, operation, context, optional revert/cause.

> [!WARNING]
> Avoid parsing `err.message` for logic — use typed fields on `err.envelope` instead.
