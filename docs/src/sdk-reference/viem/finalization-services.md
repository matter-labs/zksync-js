# Finalization Services

Helpers for building and executing **L1 finalization** of L2 withdrawals using the **Viem adapter**.
These utilities fetch the required L2→L1 proof data, check readiness, and submit `finalizeDeposit` on the **L1 Nullifier** contract.

> Use these services when you need fine-grained control (preflight simulations, custom gas, external orchestration).
> For the high-level path, see [`sdk.withdrawals.finalize(...)`](./withdrawals.md).

---

## At a Glance

* **Factory:** `createFinalizationServices(client) → FinalizationServices`
* **Workflow:** *fetch params* → *optionally check status* → *simulate readiness* → *submit finalize tx*
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

### `fetchFinalizeDepositParams(l2TxHash) → Promise<{ params, nullifier }>`

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

### `isWithdrawalFinalized(key) → Promise<boolean>`

Reads the **Nullifier mapping** to determine whether a withdrawal has already been finalized.

**Parameters**

| Name  | Type            | Required | Description                    |
| ----- | --------------- | -------- | ------------------------------ |
| `key` | `WithdrawalKey` | ✅        | Unique key for the withdrawal. |

**Returns:** `true` if finalized; otherwise `false`.

### `simulateFinalizeReadiness(params, nullifier) → Promise<FinalizeReadiness>`

Performs a **static call** on the L1 Nullifier to check whether `finalizeDeposit` **would** succeed now (no gas spent).

**Parameters**

| Name        | Type                    | Required | Description              |
| ----------- | ----------------------- | -------- | ------------------------ |
| `params`    | `FinalizeDepositParams` | ✅        | Prepared finalize input. |
| `nullifier` | `Address`               | ✅        | L1 Nullifier address.    |

**Returns:** `FinalizeReadiness` (see [Types](#types)).

### `finalizeDeposit(params, nullifier) → Promise<{ hash: string; wait: () => Promise<TransactionReceipt> }>`

Sends the **L1 finalize** transaction to the Nullifier with the provided `params`.

**Parameters**

| Name        | Type                    | Required | Description              |
| ----------- | ----------------------- | -------- | ------------------------ |
| `params`    | `FinalizeDepositParams` | ✅        | Prepared finalize input. |
| `nullifier` | `Address`               | ✅        | L1 Nullifier address.    |

**Returns**

| Field  | Type                                | Description                                   |
| ------ | ----------------------------------- | --------------------------------------------- |
| `hash` | `string`                            | Submitted L1 transaction hash.                |
| `wait` | `() => Promise<TransactionReceipt>` | Helper to await on-chain inclusion of the tx. |

> **Warning:** This call will revert if the withdrawal is not ready or invalid.
> Prefer `simulateFinalizeReadiness` or `sdk.withdrawals.wait(..., { for: 'ready' })` first.

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
