# Welcome

Learn what the `zksync-js` is and how it simplifies ZKsync cross-chain flows for **viem** and **ethers**.

## Introduction

The **`zksync-js`** is a lightweight extension for [`viem`](https://viem.sh) and [`ethers`](https://docs.ethers.io/) that makes **ZKsync cross-chain actions simple and consistent**.

Instead of re-implementing accounts or low-level RPC logic, this SDK focuses only on **ZKsync-specific flows**:

* Deposits (**L1 → L2**)
* Withdrawals (**L2 → L1**, including finalization)
* *Try* variants for functional error handling (e.g. `tryCreate`)
* Status and wait helpers
* ZKsync-specific JSON-RPC methods

> [!INFO]
> The SDK doesn’t replace your existing Ethereum libraries — it **extends** them with ZKsync-only
> capabilities while keeping your current tooling intact.

## Key Supported Features

### Deposits (L1 → L2)

Supports ETH, Custom Base Token, and ERC-20.

* **Initiate on L1:** Build and send the deposit transaction from Ethereum.
* **Track progress:** Query intermediate states (queued, included, executed).
* **Verify completion on L2:** Confirm funds credited and available on ZKsync.

### Withdrawals (L2 → L1)

Supports ETH, Custom Base Token, and ERC-20.

* **Initiate on L2:** Create the withdrawal transaction on ZKsync.
* **Track progress:** Monitor execution and finalization availability.
* **Finalize on L1:** Finalize withdrawal to release funds back to Ethereum.

### ZKsync RPC Extensions

* **`getBridgehubAddress`** (`zks_getBridgehubContract`) — resolve the canonical Bridgehub contract address.
* **`getBytecodeSupplierAddress`** (`zks_getBytecodeSupplierContract`) — resolve the Bytecode Supplier contract address.
* **`getL2ToL1LogProof`** (`zks_getL2ToL1LogProof`) — retrieve the log proof for an L2 → L1 transaction.
* **`getProof`** (`zks_getProof`) — retrieve storage slot proofs rooted in an L1 batch commitment.
* **`getReceiptWithL2ToL1`** — returns a standard Ethereum `TransactionReceipt` **augmented** with `l2ToL1Logs`.
* **`getBlockMetadataByNumber`** (`zks_getBlockMetadataByNumber`) — fetch block metadata (pubdata price, native price, execution version).
* **`getGenesis`** (`zks_getGenesis`) - returns Genesis json.

## What You’ll Find Here

* [**Mental Model**](./overview/mental-model.md) — understand the core flow:
  `quote → prepare → create → status → wait → finalize`.
* [**Adapters (viem & ethers)**](./overview/adapters.md) — how the SDK integrates with your existing stack.
* [**Withdrawal Finalization**](./overview/finalization.md) — learn the finalization process and how to ensure withdrawals are completed.

---

## Next Steps

👉 Ready to build? Start with the [**Quickstart**](../quickstart/index.md).
