# zks_ RPC

Public ZKsync `zks_*` RPC methods exposed on the adapters via `client.zks` (contract addresses, block metadata, L2→L1 log proofs, indexed Merkle tree proofs, and receipts with `l2ToL1Logs`).

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

### `getL2ToL1LogProof(txHash: Hex, index: number, proofTarget?: ProofTargetInput) → Promise<ProofNormalized>`

Return a normalized proof for the **L2→L1 log** at `index` in `txHash`.

**Parameters**

| Name          | Type               | Required | Description                                                                                                                                                    |
| ------------- | ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `txHash`      | Hex                | yes      | L2 transaction hash that emitted one or more L2→L1 logs.                                                                                                       |
| `index`       | number             | yes      | Zero-based index of the target L2→L1 log within the tx.                                                                                                        |
| `proofTarget` | `ProofTargetInput` | no       | Root the proof path terminates at. `L1BatchRoot` (default) for L1 verification; `MessageRoot` or the literal `"messageRoot"` for cross-chain interop.            |

**Returns** `ProofNormalized`

| Field                | Type    | Description                                                                                                                                               |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | bigint  | Leaf index in the batch-level L2→L1 log tree.                                                                                                             |
| `batchNumber`        | bigint  | L1 batch number the log was included in.                                                                                                                  |
| `proof`              | Hex[]   | Merkle proof elements.                                                                                                                                    |
| `root`               | Hex     | Source-chain batch root from which the returned proof path begins.                                                                                        |
| `gatewayBlockNumber` | bigint? | Settlement-layer execution block for a `messageRoot` proof. Despite the historical field name, this can be an L1 or gateway block.                       |

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

### `getImtLowNullifierIndex(value: bigint | Hex, blockNumber: number) → Promise<bigint | null>`

Return the predecessor leaf index used when inserting `value` into the atomic-interop indexed Merkle tree as it existed at `blockNumber`. A `bigint` value is encoded as a JSON-RPC hex quantity; a `Hex` value is forwarded unchanged.

The method returns `null` when the node cannot find a predecessor. Index `0n` is a valid result.

```ts
const commitValue = '0x2a' as Hex;
const lowNullifierIndex = await client.zks.getImtLowNullifierIndex(commitValue, 123);
```

---

### `getImtInclusionProof(commitValue: bigint | Hex, blockNumber: number) → Promise<ImtInclusionProof | null>`

Return the indexed Merkle tree membership proof for the leaf holding `commitValue` at the given historical L2 block. The result is normalized to SDK types: leaf values and the leaf index are `bigint`, while the root and sibling path remain `Hex`.

The method returns `null` when that commit value was not present at the requested block.

```ts
const imtProof = await client.zks.getImtInclusionProof(commitValue, 123);
if (imtProof) {
  console.log(imtProof.chainImtRoot, imtProof.imtLeafIndex);
}
```

```ts
{{#include ../../../snippets/core/rpc.test.ts:imt-proof-type}}
```

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

{{#include ../../../snippets/core/rpc.test.ts:imt-proof-type}}

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
