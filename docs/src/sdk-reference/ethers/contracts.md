# Contracts

Resolved addresses and connected core contracts for the Ethers adapter.

---

## At a Glance

* **Resource:** `sdk.contracts`
* **Capabilities:** resolve core contract addresses, return connected `ethers.Contract` instances, per-contract getters.
* **Caching:** addresses and instances are memoized by the client; call `client.refresh()` to re-resolve.

## Import

```ts
import { JsonRpcProvider, Wallet } from 'ethers';
import { createEthersClient, createEthersSdk } from '@matterlabs/zksync-js/ethers';

const l1 = new JsonRpcProvider(process.env.ETH_RPC!);
const l2 = new JsonRpcProvider(process.env.ZKSYNC_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);
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

Return connected `ethers.Contract` instances for all core contracts.

```ts
const c = await sdk.contracts.instances();
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
