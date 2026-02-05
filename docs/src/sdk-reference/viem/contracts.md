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
{{#include ../../../snippets/viem/reference/contracts.test.ts:imports}}

{{#include ../../../snippets/viem/reference/contracts.test.ts:init-sdk}}
```

## Quick Start

Resolve addresses and contract handles:

```ts
{{#include ../../../snippets/viem/reference/contracts.test.ts:ntv}}
```

## Method Reference

### `addresses() → Promise<ResolvedAddresses>`

Resolve core addresses (Bridgehub, routers, vaults, base-token system).

```ts
{{#include ../../../snippets/viem/reference/contracts.test.ts:addresses}}
```

### `instances() → Promise<{ ...contracts }>`

Return **typed** Viem contracts for all core components (each exposes `.read` / `.write` / `.simulate`).

```ts
{{#include ../../../snippets/viem/reference/contracts.test.ts:instances}}
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
{{#include ../../../snippets/viem/reference/contracts.test.ts:router}}
```

## Notes & Pitfalls

* **Caching:** `addresses()` and `instances()` are cached by the client; call `client.refresh()` to force re-resolution.
* **Token mapping:** For L1⇄L2 address mapping, asset IDs, and WETH helpers, use `sdk.tokens`.
