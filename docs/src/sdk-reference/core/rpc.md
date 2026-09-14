# zks_ RPC

Public ZKsync `zks_*` RPC methods exposed on the adapters via `client.zks` (Bridgehub address, Bytecode Supplier address, storage slot proofs, block metadata, L2→L1 log proofs, receipts with `l2ToL1Logs`).

## Standard Ethereum RPC (`eth_*`)

Use your base library for all `eth_*` methods.
The `client.zks` surface only covers ZKsync-specific RPC (`zks_*`).
For standard Ethereum JSON-RPC (e.g., `eth_call`, `eth_getLogs`, `eth_getBalance`), call them through your chosen library (**ethers** or **viem**).

## zks_ Interface

```ts
{{#include ../../../snippets/core/rpc.test.ts:zks-rpc}}
```

---

## Methods

### `getBridgehubAddress() → Promise<Address>`

Fetch the on-chain **Bridgehub** contract address.

```ts
{{#include ../../../snippets/core/rpc.test.ts:bridgehub-address}}
```

---

### `getBytecodeSupplierAddress() → Promise<Address>`

Fetch the on-chain **Bytecode Supplier** contract address.

```ts
{{#include ../../../snippets/core/rpc.test.ts:bytecode-supplier}}
```

---

### `getL2ToL1LogProof(txHash: Hex, index: number, proofTarget?: ProofTarget) → Promise<ProofNormalized>`

Return a normalized proof for the **L2→L1 log** at `index` in `txHash`.

**Parameters**

| Name          | Type          | Required | Description                                                                                     |
| ------------- | ------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `txHash`      | Hex           | yes      | L2 transaction hash that emitted one or more L2→L1 logs.                                        |
| `index`       | number        | yes      | Zero-based index of the target L2→L1 log within the tx.                                         |
| `proofTarget` | `ProofTarget` | no       | Root the proof anchors to. `L1BatchRoot` (default) for L1 verification; `MessageRoot` for cross-chain interop. |

**Returns** `ProofNormalized`

| Field                | Type     | Description                                                                                       |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `id`                 | bigint   | Log index within the transaction.                                                                 |
| `batchNumber`        | bigint   | L1 batch number the log was included in.                                                          |
| `proof`              | Hex[]    | Merkle proof elements.                                                                            |
| `root`               | Hex      | Merkle root the proof anchors to.                                                                 |
| `gatewayBlockNumber` | bigint?  | Gateway block number associated with this proof. Present when using `ProofTarget.MessageRoot`; used for cross-chain interop finalization. |

```ts
{{#include ../../../snippets/core/rpc.test.ts:proof-target}}
```

```ts
{{#include ../../../snippets/viem/overview/adapter.test.ts:log-proof}}
```

> [!INFO]
> If a proof isn’t available yet, this method throws a typed `STATE` error.
> Poll according to your app’s cadence.

---

### `getProof(address: Address, keys: Hex[], l1BatchNumber: number) → Promise<BatchStorageProof>`

Return storage slot proofs for the requested `keys`, rooted in the state after `l1BatchNumber`.

**Parameters**

| Name | Type | Required | Description |
| ---- | ---- | -------- | ----------- |
| `address` | Address | yes | Account whose storage is being proven. |
| `keys` | Hex[] | yes | Storage keys to prove. |
| `l1BatchNumber` | number | yes | L1 batch number the proof should be generated against. |

**Example**

```ts
const proof = await client.zks.getProof(
  '0x1234567890abcdef1234567890abcdef12345678',
  ['0x' + '00'.repeat(32)],
  2,
);

for (const slot of proof.storageProofs) {
  if (slot.proof.type === 'existing') {
    console.log('existing slot', slot.key, slot.proof.value);
  } else {
    console.log('missing slot', slot.key, slot.proof.leftNeighbor.index, slot.proof.rightNeighbor.index);
  }
}
```

> [!INFO]
> If the node returns `null`, this method throws a typed `STATE` error.
> That indicates the proof is not available yet, not that the slot is missing.

---

### `getReceiptWithL2ToL1(txHash: Hex) → Promise<ReceiptWithL2ToL1 | null>`

Fetch the transaction receipt; the returned object **always** includes `l2ToL1Logs` (empty array if none).

```ts
{{#include ../../../snippets/viem/overview/adapter.test.ts:receipt-with-logs}}
```

---

### `getBlockMetadataByNumber(blockNumber: number)`

**What it does**
Fetches per-block metadata used by the node (pubdata price, native price, execution version).
Returns `null` if the block metadata is unavailable.
Price fields are returned as `bigint`.

**Example**

```ts
{{#include ../../../snippets/core/rpc.test.ts:block-metadata}}
```

**Returns**

```ts
{{#include ../../../snippets/core/rpc.test.ts:metadata-type}}
```

---

### `getGenesis()`

**What it does**
Retrieves the L2 genesis configuration exposed by the node, including initial contract deployments, storage patches, execution version, and the expected genesis root.

**Example**

```ts
{{#include ../../../snippets/core/rpc.test.ts:genesis-method}}
```

**Returns**

```ts
{{#include ../../../snippets/core/rpc.test.ts:genesis-type}}
```

---

## Types (overview)

```ts
{{#include ../../../snippets/core/rpc.test.ts:zks-rpc}}

{{#include ../../../snippets/core/rpc.test.ts:proof-receipt-type}}

{{#include ../../../snippets/core/rpc.test.ts:batch-proof-type}}

{{#include ../../../snippets/core/rpc.test.ts:metadata-type}}

{{#include ../../../snippets/core/rpc.test.ts:genesis-type}}
```

---

## Usage

<details>
<summary><strong>Ethers</strong></summary>

```ts
{{#include ../../../snippets/ethers/overview/adapter-basic.test.ts:ethers-basic-imports}}

{{#include ../../../snippets/ethers/overview/adapter-basic.test.ts:init-ethers-adapter}}

// Public RPC surface:
{{#include ../../../snippets/core/rpc.test.ts:bridgehub-address}}
```

</details>

<details>
<summary><strong>Viem</strong></summary>

```ts
{{#include ../../../snippets/viem/overview/adapter.test.ts:viem-adapter-imports}}

{{#include ../../../snippets/viem/overview/adapter-basic.test.ts:init-viem-adapter}}

// Public RPC surface:
{{#include ../../../snippets/core/rpc.test.ts:bridgehub-address}}
```

</details>
