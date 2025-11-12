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
import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { createViemClient, createViemSdk, createFinalizationServices } from '@matter-labs/zksync-js/viem';

const l1 = createPublicClient({ transport: http(process.env.ETH_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.ZKSYNC_RPC!) });

const l1Wallet = createWalletClient({
  account: /* your L1 Account */,
  transport: http(process.env.ETH_RPC!),
});

const client = createViemClient({ l1, l2, l1Wallet });
// optional: const sdk = createViemSdk(client);

const svc = createFinalizationServices(client);
```

## Minimal Usage Example

```ts
import type { Hex } from 'viem';

const l2TxHash: Hex = '0x...';

// 1) Build finalize params + discover the L1 Nullifier to call
const { params, nullifier } = await svc.fetchFinalizeDepositParams(l2TxHash);

// 2) (Optional) Check if already finalized
const already = await svc.isWithdrawalFinalized({
  chainIdL2: params.chainId,
  l2BatchNumber: params.l2BatchNumber,
  l2MessageIndex: params.l2MessageIndex,
});
if (already) {
  console.log('Already finalized on L1');
} else {
  // 3) Dry-run on L1 to confirm readiness (no gas spent)
  const readiness = await svc.simulateFinalizeReadiness(params, nullifier);

  if (readiness.kind === 'READY') {
    // 4) Submit finalize tx (signed by your L1 wallet)
    const { hash, wait } = await svc.finalizeDeposit(params, nullifier);
    console.log('L1 finalize tx:', hash);
    const rcpt = await wait();
    console.log('Finalized in block:', rcpt.blockNumber);
  } else {
    console.warn('Not ready to finalize:', readiness);
  }
}
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
// Finalize call input
export interface FinalizeDepositParams {
  chainId: bigint;
  l2BatchNumber: bigint;
  l2MessageIndex: bigint;
  l2Sender: Address;
  l2TxNumberInBatch: number;
  message: Hex;
  merkleProof: Hex[];
}

// Key that identifies a withdrawal in the Nullifier mapping
export type WithdrawalKey = {
  chainIdL2: bigint;
  l2BatchNumber: bigint;
  l2MessageIndex: bigint;
};

// Overall withdrawal state (used by higher-level status helpers)
type WithdrawalPhase =
  | 'L2_PENDING'
  | 'L2_INCLUDED'
  | 'PENDING'
  | 'READY_TO_FINALIZE'
  | 'FINALIZING'
  | 'FINALIZED'
  | 'FINALIZE_FAILED'
  | 'UNKNOWN';

export type WithdrawalStatus = {
  phase: WithdrawalPhase;
  l2TxHash: Hex;
  l1FinalizeTxHash?: Hex;
  key?: WithdrawalKey;
};

// Readiness result returned by simulateFinalizeReadiness(...)
export type FinalizeReadiness =
  | { kind: 'READY' }
  | { kind: 'FINALIZED' }
  | {
      kind: 'NOT_READY';
      // temporary, retry later
      reason: 'paused' | 'batch-not-executed' | 'root-missing' | 'unknown';
      detail?: string;
    }
  | {
      kind: 'UNFINALIZABLE';
      // permanent, won’t become ready
      reason: 'message-invalid' | 'invalid-chain' | 'settlement-layer' | 'unsupported';
      detail?: string;
    };

// Viem-bound service surface
export interface FinalizationServices {
  fetchFinalizeDepositParams(
    l2TxHash: Hex,
  ): Promise<{ params: FinalizeDepositParams; nullifier: Address }>;

  isWithdrawalFinalized(key: WithdrawalKey): Promise<boolean>;

  simulateFinalizeReadiness(
    params: FinalizeDepositParams,
    nullifier: Address,
  ): Promise<FinalizeReadiness>;

  finalizeDeposit(
    params: FinalizeDepositParams,
    nullifier: Address,
  ): Promise<{ hash: string; wait: () => Promise<TransactionReceipt> }>;
}
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
