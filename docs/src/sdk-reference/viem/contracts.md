# Contracts

Resolved addresses and connected core contracts for the Viem adapter.

---

## At a Glance

* **Resource:** `sdk.contracts`
* **Capabilities:** resolve core contract addresses, return typed `getContract` instances, per-contract getters.
* **Caching:** addresses and instances are memoized by the client; call `client.refresh()` to re-resolve.
* **Token mapping:** use `sdk.tokens` for L1⇄L2 mapping and assetId helpers.
* **Error style:** Throwing methods (no `try*` variants).

## Import

```ts
import { createPublicClient, createWalletClient, http } from 'viem';
import { createViemClient, createViemSdk } from '@matterlabs/zksync-js/viem';

const l1 = createPublicClient({ transport: http(process.env.ETH_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.ZKSYNC_RPC!) });
const l1Wallet = createWalletClient({
  account: /* your L1 Account */,
  transport: http(process.env.ETH_RPC!),
});

const client = createViemClient({ l1, l2, l1Wallet });
const sdk = createViemSdk(client);
// sdk.contracts → ContractsResource
```

## Quick Start

Resolve addresses and contract handles:

```ts
const addresses = await sdk.contracts.addresses();
const { l1NativeTokenVault, l2AssetRouter } = await sdk.contracts.instances();

const ntv = await sdk.contracts.l1NativeTokenVault();
```

## Method Reference

### `addresses() → Promise<ResolvedAddresses>`

Resolve core addresses (Bridgehub, routers, vaults, base-token system).

```ts
const a = await sdk.contracts.addresses();
/*
{
  bridgehub,
  l1AssetRouter,
  l1Nullifier,
  l1NativeTokenVault,
  l2AssetRouter,
  l2NativeTokenVault,
  l2BaseTokenSystem
}
*/
```

### `instances() → Promise<{ ...contracts }>`

Return **typed** Viem contracts for all core components (each exposes `.read` / `.write` / `.simulate`).

```ts
const c = await sdk.contracts.instances();
const bridgehub = c.bridgehub;
```

### One-off Contract Getters

| Method                 | Returns             | Description                         |
| ---------------------- | ------------------- | ----------------------------------- |
| `bridgehub()`          | `Promise<Contract>` | Connected Bridgehub contract.       |
| `l1AssetRouter()`      | `Promise<Contract>` | Connected L1 Asset Router contract. |
| `l1NativeTokenVault()` | `Promise<Contract>` | Connected L1 Native Token Vault.    |
| `l1Nullifier()`        | `Promise<Contract>` | Connected L1 Nullifier contract.    |
| `l2AssetRouter()`      | `Promise<Contract>` | Connected L2 Asset Router contract. |
| `l2NativeTokenVault()` | `Promise<Contract>` | Connected L2 Native Token Vault.    |
| `l2BaseTokenSystem()`  | `Promise<Contract>` | Connected L2 Base Token System.     |

```ts
const router = await sdk.contracts.l2AssetRouter();
```

## Notes & Pitfalls

* **Caching:** `addresses()` and `instances()` are cached by the client; call `client.refresh()` to force re-resolution.
* **Token mapping:** For L1⇄L2 address mapping, asset IDs, and WETH helpers, use `sdk.tokens`.
