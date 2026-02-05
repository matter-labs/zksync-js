# EthersClient

Low-level client for the **Ethers adapter**.
Carries providers/signer, resolves core contract addresses, and exposes connected `ethers.Contract` instances.

---

## At a Glance

* **Factory:** `createEthersClient({ l1, l2, signer, overrides? }) → EthersClient`
* **Provides:** cached core **addresses**, connected **contracts**, L2-bound **ZKsync RPC** (`zks`), and a signer force-bound to **L1**.
* **Usage:** Create this first, then pass it into `createEthersSdk(client)`.

## Import

```ts
{{#include ../../../snippets/ethers/reference/client.test.ts:client-import}}
```

## Quick Start

```ts
{{#include ../../../snippets/ethers/reference/client.test.ts:ethers-import}}
{{#include ../../../snippets/ethers/reference/client.test.ts:client-import}}

{{#include ../../../snippets/ethers/reference/client.test.ts:init-client}}
```

> [!TIP]
> The signer is force-bound to the **L1** provider so that L1 finalization flows work out of the box.

## `createEthersClient(args) → EthersClient`

**Parameters**

| Name             | Type                         | Required | Description                                                                          |
| ---------------- | ---------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `args.l1`        | `ethers.AbstractProvider`    | ✅        | L1 provider for reads and L1 transactions.                                           |
| `args.l2`        | `ethers.AbstractProvider`    | ✅        | L2 (ZKsync) provider for reads and ZK RPC.                                           |
| `args.signer`    | `ethers.Signer`              | ✅        | Signer for sends. If not connected to `args.l1`, it will be automatically connected. |
| `args.overrides` | `Partial<ResolvedAddresses>` | ❌        | Optional address overrides (forks/tests).                                            |

**Returns:** `EthersClient`

## EthersClient Interface

| Property | Type                      | Description                                |
| -------- | ------------------------- | ------------------------------------------ |
| `kind`   | `'ethers'`                | Adapter discriminator.                     |
| `l1`     | `ethers.AbstractProvider` | Public L1 provider.                        |
| `l2`     | `ethers.AbstractProvider` | Public L2 (ZKsync) provider.               |
| `signer` | `ethers.Signer`           | Signer (bound to `l1` for sends).          |
| `zks`    | `ZksRpc`                  | ZKsync-specific RPC surface bound to `l2`. |

## Methods

### `ensureAddresses() → Promise<ResolvedAddresses>`

Resolve and cache core contract addresses from chain state (merges any `overrides`).

```ts
{{#include ../../../snippets/ethers/reference/client.test.ts:ensureAddresses}}
```

### `contracts() → Promise<{ ...contracts }>`

Return connected `ethers.Contract` instances for all core contracts.

```ts
{{#include ../../../snippets/ethers/reference/client.test.ts:contracts}}
```

### `refresh(): void`

Clear cached addresses/contracts. Subsequent calls re-resolve.

```ts
{{#include ../../../snippets/ethers/reference/client.test.ts:refresh}}
```

### `baseToken(chainId: bigint) → Promise<Address>`

Return the **L1 base-token address** for a given L2 chain via `Bridgehub.baseToken(chainId)`.

```ts
{{#include ../../../snippets/ethers/reference/client.test.ts:base}}
```

## Types

### `ResolvedAddresses`

```ts
{{#include ../../../snippets/ethers/reference/client.test.ts:resolved-type}}
```

## Notes & Pitfalls

* **Provider roles:**
  `l1` handles L1 lookups and finalization sends;
  `l2` handles ZKsync reads/RPC via `zks`.

* **Signer binding:**
  The signer is always connected to `l1` to ensure L1 transactions (e.g., finalization) succeed without manual setup.

* **Caching:**
  `ensureAddresses()` and `contracts()` are cached.
  Call `refresh()` after network changes or applying new overrides.

* **Overrides:**
  For forks or custom deployments, pass `overrides` during construction — they merge with on-chain resolution.
