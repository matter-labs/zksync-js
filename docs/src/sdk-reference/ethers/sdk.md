# EthersSdk

High-level SDK built on top of the **Ethers adapter** — provides deposits, withdrawals, and token/contract resources.

---

## At a Glance

* **Factory:** `createEthersSdk(client) → EthersSdk`
* **Composed resources:** `sdk.deposits`, `sdk.withdrawals`, `sdk.tokens`, `sdk.contracts`
* **Client vs SDK:** The **client** wires RPC/signing, while the **SDK** adds high-level flows (`quote → prepare → create → wait`) plus token and contract resources.

## Import

```ts
{{#include ../../../snippets/ethers/reference/sdk.test.ts:sdk-import}}
```

## Quick Start

```ts
{{#include ../../../snippets/ethers/reference/sdk.test.ts:ethers-import}}
{{#include ../../../snippets/ethers/reference/sdk.test.ts:eth-import}}
{{#include ../../../snippets/ethers/reference/sdk.test.ts:sdk-import}}

{{#include ../../../snippets/ethers/reference/sdk.test.ts:init-sdk}}

{{#include ../../../snippets/ethers/reference/sdk.test.ts:erc-20-address}}

{{#include ../../../snippets/ethers/reference/sdk.test.ts:basic-sdk}}
```

> [!TIP]
> The SDK composes the client with resources: `deposits`, `withdrawals`, `tokens`, and `contracts`.

## `createEthersSdk(client) → EthersSdk`

**Parameters**

| Name     | Type           | Required | Description                                                    |
| -------- | -------------- | -------- | -------------------------------------------------------------- |
| `client` | `EthersClient` | ✅        | Instance returned by `createEthersClient({ l1, l2, signer })`. |

**Returns:** `EthersSdk`

## EthersSdk Interface

### `deposits: DepositsResource`

L1 → L2 flows.
See [Deposits](./deposits.md).

### `withdrawals: WithdrawalsResource`

L2 → L1 flows.
See [Withdrawals](./withdrawals.md).

### `tokens: TokensResource`

Token identity, L1⇄L2 mapping, bridge asset IDs, chain token facts.
See [Tokens](./tokens.md).

### `contracts: ContractsResource`

Resolved addresses and connected contract instances.
See [Contracts](./contracts.md).

## `contracts`

Utilities for resolved addresses and connected contracts. Token mapping lives in `sdk.tokens`.

### `addresses() → Promise<ResolvedAddresses>`

Resolve core addresses (Bridgehub, routers, vaults, base-token system).

```ts
{{#include ../../../snippets/ethers/reference/sdk.test.ts:contract-addresses}}
```

### `instances() → Promise<{ ...contracts }>`

Return connected `ethers.Contract` instances for all core contracts.

```ts
{{#include ../../../snippets/ethers/reference/sdk.test.ts:contract-instances}}
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
{{#include ../../../snippets/ethers/reference/sdk.test.ts:nullifier}}
```

## Notes & Pitfalls

* **Client first:**
  Always construct the **client** with `{ l1, l2, signer }` before creating the SDK.

* **Chain-derived behavior:**
  Contracts and token methods pull from on-chain data — results vary by network.

* **Error model:**
  All resource methods throw typed errors. Prefer `try*` variants (e.g., `tryCreate`) for structured results.
