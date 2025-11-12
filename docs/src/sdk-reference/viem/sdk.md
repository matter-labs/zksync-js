# ViemSdk

High-level SDK built on top of the **Viem adapter** — provides deposits, withdrawals, and chain-aware helpers.

---

## At a Glance

* **Factory:** `createViemSdk(client) → ViemSdk`
* **Composed resources:** `sdk.deposits`, `sdk.withdrawals`, `sdk.helpers`
* **Client vs SDK:** The **client** wires RPC/signing; the **SDK** adds high-level flows (`quote → prepare → create → wait`) and convenience helpers.
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
const { l1NativeTokenVault } = await sdk.helpers.contracts();
const l2Crown = await sdk.helpers.l2TokenAddress(CROWN_ERC20_ADDRESS);
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
> The SDK composes the client with resources: `deposits`, `withdrawals`, and convenience `helpers`.

## ViemSdk Interface

### `deposits: DepositsResource`

L1 → L2 flows.
See [Deposits](./deposits.md).

### `withdrawals: WithdrawalsResource`

L2 → L1 flows.
See [Withdrawals](./withdrawals.md).

## `helpers`

Utilities for chain addresses, connected contracts, and L1↔L2 token mapping.

### `addresses() → Promise<ResolvedAddresses>`

Resolve core addresses (Bridgehub, routers, vaults, base-token system).

```ts
const a = await sdk.helpers.addresses();
```

### `contracts() → Promise<{ ...contracts }>`

**Typed** Viem contracts for all core components (each exposes `.read` / `.write` / `.simulate`).

```ts
const c = await sdk.helpers.contracts();
const bridgehub = c.bridgehub;
```

### One-off Contract Getters

| Method                 | Returns             | Description                      |
| ---------------------- | ------------------- | -------------------------------- |
| `l1AssetRouter()`      | `Promise<Contract>` | Connected L1 Asset Router.       |
| `l1NativeTokenVault()` | `Promise<Contract>` | Connected L1 Native Token Vault. |
| `l1Nullifier()`        | `Promise<Contract>` | Connected L1 Nullifier contract. |

```ts
const nullifier = await sdk.helpers.l1Nullifier();
```

### `baseToken(chainId?: bigint) → Promise<Address>`

L1 address of the **base token** for the current (or supplied) L2 chain.

```ts
const base = await sdk.helpers.baseToken(); // infers from the L2 client
```

### `l2TokenAddress(l1Token: Address) → Promise<Address>`

L2 token address for an L1 token.

* Handles ETH special case (L2 ETH placeholder).
* If the token is the chain’s base token, returns the L2 base-token system address.
* Otherwise queries `IL2NativeTokenVault.l2TokenAddress`.

```ts
const l2Crown = await sdk.helpers.l2TokenAddress(CROWN_ERC20_ADDRESS);
```

### `l1TokenAddress(l2Token: Address) → Promise<Address>`

L1 token for an L2 token via `IL2AssetRouter.l1TokenAddress`.
ETH placeholder resolves to canonical ETH.

```ts
const l1Crown = await sdk.helpers.l1TokenAddress(L2_CROWN_ADDRESS);
```

### `assetId(l1Token: Address) → Promise<Hex>`

`bytes32` asset ID via `L1NativeTokenVault.assetId` (ETH handled canonically).

```ts
const id = await sdk.helpers.assetId(CROWN_ERC20_ADDRESS);
```

---

## Notes & Pitfalls

* **Wallet placement matters:** Deposits sign on **L1**; withdrawals sign on **L2**; finalization signs on **L1**.
* **Chain-derived behavior:** Helpers read from on-chain sources; results depend on connected networks.
* **Error model:** Resource methods throw typed errors; prefer `try*` variants on resources for result objects.
