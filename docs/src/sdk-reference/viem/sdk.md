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
import { createViemClient, createViemSdk } from '@matterlabs/zksync-js/viem';
```

## Quick Start

```ts
import { createPublicClient, createWalletClient, http } from 'viem';
import { createViemClient, createViemSdk, ETH_ADDRESS } from '@matterlabs/zksync-js/viem';

// Public clients (reads)
const l1 = createPublicClient({ transport: http(process.env.ETH_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.ZKSYNC_RPC!) });

// Wallet clients (writes)
const l1Wallet = createWalletClient({
  account: /* your L1 Account */,
  transport: http(process.env.ETH_RPC!),
});

const l2Wallet = createWalletClient({
  account: /* your L2 Account (can be the same key) */,
  transport: http(process.env.ZKSYNC_RPC!),
});

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
const sdk = createViemSdk(client);

// Example: deposit 0.05 ETH L1 → L2, wait for L2 execution
const handle = await sdk.deposits.create({
  token: ETH_ADDRESS,               // 0x…00 sentinel for ETH
  amount: 50_000_000_000_000_000n,  // 0.05 ETH in wei
  to: l2Wallet.account.address,
});
await sdk.deposits.wait(handle, { for: 'l2' });

// Example: resolve contracts and map an L1 token to its L2 address
const { l1NativeTokenVault } = await sdk.contracts.instances();
const token = await sdk.tokens.resolve('0xYourToken');
console.log(token.l2);
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
const a = await sdk.contracts.addresses();
```

### `instances() → Promise<{ ...contracts }>`

**Typed** Viem contracts for all core components (each exposes `.read` / `.write` / `.simulate`).

```ts
const c = await sdk.contracts.instances();
const bridgehub = c.bridgehub;
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
const nullifier = await sdk.contracts.l1Nullifier();
```

---

## Notes & Pitfalls

* **Wallet placement matters:** Deposits sign on **L1**; withdrawals sign on **L2**; finalization signs on **L1**.
* **Chain-derived behavior:** Contracts and tokens read from on-chain sources; results depend on connected networks.
* **Error model:** Resource methods throw typed errors; prefer `try*` variants on resources for result objects.
