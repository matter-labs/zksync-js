# ViemClient

Low-level client for the **Viem adapter**.
Provides cached core contract addresses, typed contract access, convenience wallet derivation, and ZKsync RPC integration.

---

## At a Glance

* **Factory:** `createViemClient({ l1, l2, l1Wallet, l2Wallet?, overrides? }) → ViemClient`
* **Provides:** cached core **addresses**, typed **contracts**, convenience **wallet access**, and ZKsync **RPC** bound to `l2`.
* **Usage:** create this first, then pass it to `createViemSdk(client)`.

## Import

```ts
import { createViemClient } from '@matterlabs/zksync-js/viem';
```

## Quick Start

```ts
import { createPublicClient, createWalletClient, http } from 'viem';

// Public clients (reads)
const l1 = createPublicClient({ transport: http(process.env.ETH_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.ZKSYNC_RPC!) });

// Wallet clients (writes)
const l1Wallet = createWalletClient({
  account: /* your L1 account */,
  transport: http(process.env.ETH_RPC!),
});

// Optional dedicated L2 wallet (required for L2 sends, e.g., withdrawals)
const l2Wallet = createWalletClient({
  account: /* can be same key as L1 */,
  transport: http(process.env.ZKSYNC_RPC!),
});

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });

// Resolve core addresses (cached)
const addrs = await client.ensureAddresses();

// Typed contracts (viem getContract)
const { bridgehub, l1AssetRouter } = await client.contracts();
```

> [!TIP]
> `l1Wallet.account` is required.
> If you omit `l2Wallet`, use `client.getL2Wallet()` — it will lazily derive one using the L1 account over the L2 transport.

## `createViemClient(args) → ViemClient`

**Parameters**

| Name        | Type                                           | Required | Description                                                                 |
| ----------- | ---------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `l1`        | `viem.PublicClient`                            | ✅        | L1 client for reads and chain metadata.                                     |
| `l2`        | `viem.PublicClient`                            | ✅        | L2 (ZKsync) client for reads and ZK RPC access.                             |
| `l1Wallet`  | `viem.WalletClient<Transport, Chain, Account>` | ✅        | L1 wallet (must include an `account`) used for L1 transactions.             |
| `l2Wallet`  | `viem.WalletClient<Transport, Chain, Account>` | ❌        | Optional dedicated L2 wallet for L2 sends. Needed for withdrawals. |
| `overrides` | `Partial<ResolvedAddresses>`                   | ❌        | Optional contract address overrides (forks/tests).                          |

**Returns:** `ViemClient`

## ViemClient Interface

| Property   | Type                                      | Description                                     |
| ---------- | ----------------------------------------- | ----------------------------------------------- |
| `kind`     | `'viem'`                                  | Adapter discriminator.                          |
| `l1`       | `viem.PublicClient`                       | Public L1 client.                               |
| `l2`       | `viem.PublicClient`                       | Public L2 (ZKsync) client.                      |
| `l1Wallet` | `viem.WalletClient<T, C, A>`              | Wallet bound to L1 (carries default `account`). |
| `l2Wallet` | `viem.WalletClient<T, C, A> \| undefined` | Optional pre-supplied L2 wallet.                |
| `account`  | `viem.Account`                            | Default account (from `l1Wallet`).              |
| `zks`      | `ZksRpc`                                  | ZKsync-specific RPC surface bound to `l2`.      |

## Methods

### `ensureAddresses() → Promise<ResolvedAddresses>`

Resolve and cache core contract addresses from chain state (merging any provided overrides).

```ts
const a = await client.ensureAddresses();
/*
{
  bridgehub, l1AssetRouter, l1Nullifier, l1NativeTokenVault,
  l2AssetRouter, l2NativeTokenVault, l2BaseTokenSystem
}
*/
```

### `contracts() → Promise<{ ...contracts }>`

Return **typed** Viem contracts (`getContract`) connected to the current clients.

```ts
const c = await client.contracts();
const bh = c.bridgehub; // bh.read.*, bh.write.*, bh.simulate.*
```

### `refresh(): void`

Clear cached addresses and contracts.
Subsequent calls to `ensureAddresses()` or `contracts()` will re-resolve.

```ts
client.refresh();
await client.ensureAddresses();
```

### `baseToken(chainId: bigint) → Promise<Address>`

Return the **L1 base-token address** for a given L2 chain via `Bridgehub.baseToken(chainId)`.

```ts
const base = await client.baseToken(324n /* example chain ID */);
```

### `getL2Wallet() → viem.WalletClient`

Return or lazily derive an L2 wallet from the same `account` as the L1 wallet.

```ts
const w = client.getL2Wallet(); // ensures L2 writes are possible
```

## Types

### `ResolvedAddresses`

```ts
type ResolvedAddresses = {
  bridgehub: Address;
  l1AssetRouter: Address;
  l1Nullifier: Address;
  l1NativeTokenVault: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  l2BaseTokenSystem: Address;
};
```

## Notes & Pitfalls

* **Wallet roles:**

  * Deposits sign on **L1**
  * Withdrawals sign on **L2**
  * Finalization signs on **L1**

* **Caching:**
  `ensureAddresses()` and `contracts()` are cached.
  Use `refresh()` after network or override changes.

* **Overrides:**
  For forks or custom deployments, pass `overrides` during construction.
  They merge with on-chain lookups.

* **Error handling:**
  Low-level client methods may throw typed SDK errors.
  For structured results, prefer the SDK’s `try*` variants on higher-level resources.
