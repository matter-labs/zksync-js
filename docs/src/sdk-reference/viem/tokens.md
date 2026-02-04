# Tokens

Token identity, L1↔L2 mapping, bridge asset IDs, and chain token facts for ETH, base token, and ERC-20s.

---

## At a Glance

* **Resource:** `sdk.tokens`
* **Capabilities:** resolve tokens, map L1⇄L2 addresses, compute `assetId`, detect base token, WETH helpers, predict bridged addresses.
* **Auto-handling:** ETH aliases (`ETH_ADDRESS`, `FORMAL_ETH_ADDRESS`) and L2 base-token alias are normalized for you.
* **Error style:** Throwing methods; wrap in try/catch or use higher-level `try*` callers.

## Import

```ts
{{#include ../../../snippets/viem/reference/sdk.test.ts:viem-import}}
{{#include ../../../snippets/viem/reference/sdk.test.ts:sdk-import}}

{{#include ../../../snippets/viem/reference/sdk.test.ts:init-sdk}}
// sdk.tokens → TokensResource
```

## Quick Start

Resolve a token by L1 address and fetch its L2 counterpart + bridge metadata:

```ts
{{#include ../../../snippets/viem/reference/sdk.test.ts:resolve-token}}
```

Map addresses directly:

```ts
{{#include ../../../snippets/viem/reference/sdk.test.ts:map-token}}
```

Compute bridge identifiers:

```ts
{{#include ../../../snippets/viem/reference/sdk.test.ts:token-asset-ids}}
```

## Method Reference

### `resolve(ref: Address | TokenRef, opts?: { chain?: 'l1' | 'l2' }) → Promise<ResolvedToken>`

Resolve a token reference into full metadata (kind, addresses, assetId, chain facts).

### L1↔L2 Mapping

* `toL2Address(l1Token: Address) → Promise<Address>` — returns L2 token; base token → `L2_BASE_TOKEN_ADDRESS`, ETH aliases normalized.
* `toL1Address(l2Token: Address) → Promise<Address>` — returns L1 token; ETH alias normalized.

### Bridge Identity

* `assetIdOfL1(l1Token: Address) → Promise<Hex>`
* `assetIdOfL2(l2Token: Address) → Promise<Hex>`
* `l2TokenFromAssetId(assetId: Hex) → Promise<Address>`
* `l1TokenFromAssetId(assetId: Hex) → Promise<Address>`
* `originChainId(assetId: Hex) → Promise<bigint>`

### Chain Token Facts

* `baseTokenAssetId() → Promise<Hex>` — cached.
* `isChainEthBased() → Promise<boolean>` — compares base token assetId vs ETH assetId.
* `wethL1() → Promise<Address>` — cached WETH on L1.
* `wethL2() → Promise<Address>` — cached WETH on L2.

### Address Prediction

* `computeL2BridgedAddress({ originChainId, l1Token }) → Promise<Address>` — deterministic CREATE2 address for a bridged token; handles ETH alias normalization.

## Notes & Pitfalls

* **Caching:** `baseTokenAssetId`, `wethL1`, `wethL2`, and the origin chain id are memoized; repeated calls avoid extra RPC hits.
* **ETH aliases:** Both `0xEeeee…` (ETH sentinel) and `FORMAL_ETH_ADDRESS` are normalized to canonical ETH.
* **Base token alias:** `L2_BASE_TOKEN_ADDRESS` maps back to the L1 base token via `toL1Address`.
* **Error handling:** Methods throw typed errors via the adapters’ error handlers. Wrap with `try/catch` or rely on higher-level `try*` patterns.
