# Finalization Services

Helpers for building and executing **L1 finalization** of L2 withdrawals using the **Viem adapter**.
These utilities fetch the required L2→L1 proof data, check readiness, and submit the finalization tx on L1.
They are **protocol-aware**: on protocol v31 and below they call `finalizeDeposit` on the **L1 Nullifier**;
from v32 on they call `executeBundle` on the **L1 InteropHandler**, which replaced it.

> Use these services when you need fine-grained control (preflight simulations, custom gas, external orchestration).
> For the high-level path, see [`sdk.withdrawals.finalize(...)`](./withdrawals.md).

---

## At a Glance

* **Factory:** `createFinalizationServices(client) → FinalizationServices`
* **Workflow:** *fetch finalization* → *optionally check status* → *simulate readiness* → *submit finalize tx*
* **Prereq:** An initialized **ViemClient** with an **L1 wallet** (used to sign the L1 finalize tx).

## Import & Setup

```ts
{{#include ../../../snippets/viem/reference/finalization-service.test.ts:imports}}

{{#include ../../../snippets/viem/reference/finalization-service.test.ts:init-sdk}}
```

## Minimal Usage Example

```ts
{{#include ../../../snippets/viem/reference/finalization-service.test.ts:finalize-with-svc}}
```

> **Tip:** If you prefer the SDK to handle readiness checks automatically, call `sdk.withdrawals.finalize(l2TxHash)` instead.

## API

### `fetchFinalization(l2TxHash) → Promise<ResolvedWithdrawalFinalization>`

Derives the finalization arguments for a given **L2 withdrawal tx**, tagged with the withdrawal
protocol the chain speaks. This is the protocol-neutral entry point: it resolves to
`L1Nullifier.finalizeDeposit` on protocol v31 and below, and to `L1InteropHandler.executeBundle` on
v32 and above.

**Parameters**

| Name       | Type  | Required | Description                     |
| ---------- | ----- | -------- | ------------------------------- |
| `l2TxHash` | `Hex` | ✅        | L2 withdrawal transaction hash. |

**Returns**

| Field          | Type                      | Description                                                          |
| -------------- | ------------------------- | -------------------------------------------------------------------- |
| `target`       | `Address`                 | L1 contract to send the finalization to.                             |
| `finalization` | `WithdrawalFinalization`  | Protocol-tagged finalize input (see [Types](#types)).                |
| `key`          | `WithdrawalKey`           | Identifying key; carries `bundleHash` on v32+.                       |

### `fetchFinalizeDepositParams(l2TxHash) → Promise<{ params, nullifier }>`

> [!WARNING]
> **Deprecated.** Only meaningful on protocol v31 chains. On v32+ this throws, because
> `L1Nullifier.finalizeDeposit` no longer exists. Use `fetchFinalization` instead.

Builds the inputs required by **`Nullifier.finalizeDeposit`** for a given **L2 withdrawal tx**.

**Parameters**

| Name       | Type  | Required | Description                     |
| ---------- | ----- | -------- | ------------------------------- |
| `l2TxHash` | `Hex` | ✅        | L2 withdrawal transaction hash. |

**Returns**

| Field       | Type                    | Description                                         |
| ----------- | ----------------------- | --------------------------------------------------- |
| `params`    | `FinalizeDepositParams` | Canonical finalize input (proof, indices, message). |
| `nullifier` | `Address`               | L1 Nullifier contract address to call.              |

### `isWithdrawalFinalized(finalization) → Promise<boolean>`

Checks whether the withdrawal has already been finalized on L1. Reads the **Nullifier mapping** on
v31, and the **interop handler's bundle status** on v32+ (finalized means `FullyExecuted` or
`Unbundled`).

**Parameters**

| Name           | Type                     | Required | Description                              |
| -------------- | ------------------------ | -------- | ---------------------------------------- |
| `finalization` | `WithdrawalFinalization` | ✅        | As returned by `fetchFinalization`.      |

**Returns:** `true` if finalized; otherwise `false`.

### `simulateFinalizeReadiness(finalization) → Promise<FinalizeReadiness>`

Performs a **static call** on the resolved L1 contract to check whether finalization **would**
succeed now (no gas spent).

**Parameters**

| Name           | Type                     | Required | Description                         |
| -------------- | ------------------------ | -------- | ----------------------------------- |
| `finalization` | `WithdrawalFinalization` | ✅        | As returned by `fetchFinalization`. |

**Returns:** `FinalizeReadiness`

Readiness states (see [Types](#types)) include:

* `{ kind: 'READY' }`
* `{ kind: 'FINALIZED' }`
* `{ kind: 'NOT_READY', reason, detail? }` (temporary)
* `{ kind: 'UNFINALIZABLE', reason, detail? }` (permanent)

### `estimateFinalization(finalization) → Promise<FinalizationEstimate>`

Estimates gas and per-gas fees for the L1 finalization transaction.

**Parameters**

| Name           | Type                     | Required | Description                         |
| -------------- | ------------------------ | -------- | ----------------------------------- |
| `finalization` | `WithdrawalFinalization` | ✅        | As returned by `fetchFinalization`. |

### `finalize(finalization) → Promise<{ hash; wait: () => Promise<TransactionReceipt> }>`

Sends the **L1 finalize** transaction — `finalizeDeposit` on the Nullifier (v31) or `executeBundle`
on the interop handler (v32+).

**Parameters**

| Name           | Type                     | Required | Description                         |
| -------------- | ------------------------ | -------- | ----------------------------------- |
| `finalization` | `WithdrawalFinalization` | ✅        | As returned by `fetchFinalization`. |

**Returns**

| Field  | Type                                | Description                                   |
| ------ | ----------------------------------- | --------------------------------------------- |
| `hash` | `string`                            | Submitted L1 transaction hash.                |
| `wait` | `() => Promise<TransactionReceipt>` | Helper to await on-chain inclusion of the tx. |

> [!WARNING]
> This method will **revert** if the withdrawal is not ready or invalid.
> Prefer calling `simulateFinalizeReadiness` or using `sdk.withdrawals.wait(..., { for: 'ready' })` first.

## Status & Phases

If you are also using `sdk.withdrawals.status(...)`, the phases align conceptually with readiness:

| Withdrawal Phase    | Meaning                                                 | Readiness interpretation            |
| ------------------- | ------------------------------------------------------- | ----------------------------------- |
| `L2_PENDING`        | L2 tx not in a block yet                                | Not ready                           |
| `L2_INCLUDED`       | L2 receipt is available                                 | Not ready (proof not derivable yet) |
| `PENDING`           | Inclusion known; proof data not yet derivable/available | `NOT_READY`                         |
| `READY_TO_FINALIZE` | Proof posted; can be finalized on L1                    | `READY`                             |
| `FINALIZING`        | L1 finalize tx sent but not yet indexed                 | Between `READY` and `FINALIZED`     |
| `FINALIZED`         | Withdrawal finalized on L1                              | `FINALIZED`                         |
| `FINALIZE_FAILED`   | Prior L1 finalize reverted                              | Possibly `UNFINALIZABLE`            |
| `UNKNOWN`           | No L2 hash or insufficient data                         | N/A                                 |

## Types

```ts
{{#include ../../../snippets/ethers/reference/withdrawals.test.ts:status-type}}

{{#include ../../../snippets/ethers/reference/finalization-service.test.ts:finalization-types}}
```

---

## Notes & Pitfalls

* **Anyone can finalize:** The withdrawer, a relayer, or your backend—finalization is permissionless.
* **Delay is expected:** Proof generation/posting introduce lag between L2 inclusion and readiness.
* **Gas:** Finalization is an **L1 transaction**; ensure the **L1 wallet** has ETH for gas.
* **Error surface:** Underlying calls can throw typed errors (`STATE`, `RPC`, `VERIFICATION`). Check readiness to avoid avoidable failures.

## Cross-References

* [Withdrawals (Viem)](./withdrawals.md)
* [Finalization Overview](/overview/finalization.md)
* [Status vs Wait](/overview/status-vs-wait.md)
