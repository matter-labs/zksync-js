# zks_ RPC

Public ZKsync `zks_*` RPC methods exposed on the adapters via `client.zks` (Bridgehub address, Bytecode Supplier address, block metadata, L2→L1 log proofs, receipts with `l2ToL1Logs`).

## Standard Ethereum RPC (`eth_*`)

Use your base library for all `eth_*` methods.
The `client.zks` surface only covers ZKsync-specific RPC (`zks_*`).
For standard Ethereum JSON-RPC (e.g., `eth_call`, `eth_getLogs`, `eth_getBalance`), call them through your chosen library (**ethers** or **viem**).

## zks_ Interface

```ts
interface ZksRpc {
  getBridgehubAddress(): Promise<Address>;
  getBytecodeSupplierAddress(): Promise<Address>;
  getL2ToL1LogProof(txHash: Hex, index: number): Promise<ProofNormalized>;
  getReceiptWithL2ToL1(txHash: Hex): Promise<ReceiptWithL2ToL1 | null>;
  getBlockMetadataByNumber(blockNumber: number): Promise<BlockMetadata | null>;
  getGenesis(): Promise<GenesisInput>;
}
```

---

## Methods

### `getBridgehubAddress() → Promise<Address>`

Fetch the on-chain **Bridgehub** contract address.

```ts
const addr = await client.zks.getBridgehubAddress();
```

---

### `getBytecodeSupplierAddress() → Promise<Address>`

Fetch the on-chain **Bytecode Supplier** contract address.

```ts
const addr = await client.zks.getBytecodeSupplierAddress();
```

---

### `getL2ToL1LogProof(txHash: Hex, index: number) → Promise<ProofNormalized>`

Return a normalized proof for the **L2→L1 log** at `index` in `txHash`.

**Parameters**

| Name     | Type   | Required | Description                                              |
| -------- | ------ | -------- | -------------------------------------------------------- |
| `txHash` | Hex    | yes      | L2 transaction hash that emitted one or more L2→L1 logs. |
| `index`  | number | yes      | Zero-based index of the target L2→L1 log within the tx.  |

```ts
const proof = await client.zks.getL2ToL1LogProof(l2TxHash, 0);
/*
{
  id: bigint,
  batchNumber: bigint,
  proof: Hex[]
}
*/
```

> [!INFO]
> If a proof isn’t available yet, this method throws a typed `STATE` error.
> Poll according to your app’s cadence.

---

### `getReceiptWithL2ToL1(txHash: Hex) → Promise<ReceiptWithL2ToL1 | null>`

Fetch the transaction receipt; the returned object **always** includes `l2ToL1Logs` (empty array if none).

```ts
const rcpt = await client.zks.getReceiptWithL2ToL1(l2TxHash);
console.log(rcpt?.l2ToL1Logs); // always an array
```

---

### `getBlockMetadataByNumber(blockNumber: number)`

**What it does**
Fetches per-block metadata used by the node (pubdata price, native price, execution version).
Returns `null` if the block metadata is unavailable.
Price fields are returned as `bigint`.

**Example**

```ts
const meta = await client.zks.getBlockMetadataByNumber(123_456);
if (meta) {
  console.log(meta.pubdataPricePerByte, meta.nativePrice, meta.executionVersion);
}
```

**Returns**

```ts
type BlockMetadata = {
  pubdataPricePerByte: bigint;
  nativePrice: bigint;
  executionVersion: number;
};
```

---

## Types (overview)

```ts
type ProofNormalized = {
  id: bigint;
  batchNumber: bigint;
  proof: Hex[];
  root: Hex;
};

type ReceiptWithL2ToL1 = {
  // …standard receipt fields…
  l2ToL1Logs: unknown[];
};

type BlockMetadata = {
  pubdataPricePerByte: bigint;
  nativePrice: bigint;
  executionVersion: number;
};
```

---

## `getGenesis()`

**What it does**
Retrieves the L2 genesis configuration exposed by the node, including initial contract deployments, storage patches, execution version, and the expected genesis root.

**Example**

```ts
const genesis = await client.zks.getGenesis();

for (const contract of genesis.initialContracts) {
  console.log('Contract at', contract.address, 'with bytecode', contract.bytecode);
}

console.log('Execution version:', genesis.executionVersion);
console.log('Genesis root:', genesis.genesisRoot);
```

**Returns**

```ts
type GenesisInput = {
  initialContracts: {
    address: Address;
    bytecode: `0x${string}`;
  }[];
  additionalStorage: {
    key: `0x${string}`;
    value: `0x${string}`;
  }[];
  executionVersion: number;
  genesisRoot: `0x${string}`;
};
```

---

## Usage

<details>
<summary><strong>Ethers</strong></summary>

```ts
import { JsonRpcProvider, Wallet } from 'ethers';
import { createEthersClient } from '@matterlabs/zksync-js/ethers';

const l1 = new JsonRpcProvider(process.env.ETH_RPC!);
const l2 = new JsonRpcProvider(process.env.ZKSYNC_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });

// Public RPC surface:
const bridgehub = await client.zks.getBridgehubAddress();
```

</details>

<details>
<summary><strong>Viem</strong></summary>

```ts
import { createPublicClient, http } from 'viem';
import { createViemClient } from '@matterlabs/zksync-js/viem';

const l1 = createPublicClient({ transport: http(process.env.ETH_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.ZKSYNC_RPC!) });

// Provide a WalletClient with an account for L1 operations.
const l1Wallet = /* your WalletClient w/ account */;

const client = createViemClient({ l1, l2, l1Wallet });

// Public RPC surface:
const bridgehub = await client.zks.getBridgehubAddress();
```

</details>
