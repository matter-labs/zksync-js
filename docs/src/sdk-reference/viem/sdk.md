# ViemSdk

High-level SDK built on top of the **Viem adapter** — provides deposits, withdrawals, tokens, and contract resources.

---

## At a Glance

* **Factory:** `createViemSdk(client) → ViemSdk`
* **Composed resources:** `sdk.deposits`, `sdk.withdrawals`, `sdk.tokens`, `sdk.contracts`
* **Client vs SDK:** The **client** wires RPC/signing; the **SDK** adds high-level flows (`quote → prepare → create → wait`) plus token and contract resources.
* **Wallets by flow:**

  * **Deposits (L1 tx):** `l1Wallet` required
  * **Withdrawals (L2 tx):** `l2Wallet` required
  * **Finalize (L1 tx):** `l1Wallet` required

## Import

```ts
{{#include ../../../snippets/viem/reference/sdk.test.ts:sdk-import}}
```

## Quick Start

```ts
{{#include ../../../snippets/viem/reference/sdk.test.ts:sdk-import}}
{{#include ../../../snippets/viem/reference/sdk.test.ts:viem-import}}
{{#include ../../../snippets/viem/reference/sdk.test.ts:eth-import}}

{{#include ../../../snippets/viem/reference/sdk.test.ts:init-sdk}}

{{#include ../../../snippets/viem/reference/sdk.test.ts:erc-20-address}}

{{#include ../../../snippets/viem/reference/sdk.test.ts:basic-sdk}}
```

> [!TIP]
> You can construct the client with only the wallets you need for a given flow (e.g., just `l2Wallet` to create withdrawals; add `l1Wallet` when you plan to finalize).

## `createViemSdk(client) → ViemSdk`

**Parameters**

| Name     | Type         | Required | Description                                                                |
| -------- | ------------ | -------- | -------------------------------------------------------------------------- |
| `client` | `ViemClient` | ✅        | Instance returned by `createViemClient({ l1, l2, l1Wallet?, l2Wallet? })`. |

**Returns:** `ViemSdk`

> [!TIP]
> The SDK composes the client with resources: `deposits`, `withdrawals`, `tokens`, and `contracts`.

## ViemSdk Interface

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
{{#include ../../../snippets/viem/reference/sdk.test.ts:contract-addresses}}
```

### `instances() → Promise<{ ...contracts }>`

**Typed** Viem contracts for all core components (each exposes `.read` / `.write` / `.simulate`).

```ts
{{#include ../../../snippets/viem/reference/sdk.test.ts:contract-instances}}
```

### One-off Contract Getters

| Method                 | Returns             | Description                         |
| ---------------------- | ------------------- | ----------------------------------- |
| `bridgehub()`          | `Promise<Contract>` | Connected Bridgehub contract.       |
| `l1AssetRouter()`      | `Promise<Contract>` | Connected L1 Asset Router.          |
| `l1NativeTokenVault()` | `Promise<Contract>` | Connected L1 Native Token Vault.    |
| `l1Nullifier()`        | `Promise<Contract>` | Connected L1 Nullifier contract.    |
| `l2AssetRouter()`      | `Promise<Contract>` | Connected L2 Asset Router contract. |
| `l2NativeTokenVault()` | `Promise<Contract>` | Connected L2 Native Token Vault.    |
| `l2BaseTokenSystem()`  | `Promise<Contract>` | Connected L2 Base Token System.     |

```ts
{{#include ../../../snippets/viem/reference/sdk.test.ts:nullifier}}
```

---

## Notes & Pitfalls

* **Wallet placement matters:** Deposits sign on **L1**; withdrawals sign on **L2**; finalization signs on **L1**.
* **Chain-derived behavior:** Contracts and tokens read from on-chain sources; results depend on connected networks.
* **Error model:** Resource methods throw typed errors; prefer `try*` variants on resources for result objects.
