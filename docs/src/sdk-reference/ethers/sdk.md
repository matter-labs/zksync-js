# EthersSdk

High-level SDK built on top of the **Ethers adapter** — provides deposits, withdrawals, and chain-aware helpers.

---

## At a Glance

* **Factory:** `createEthersSdk(client) → EthersSdk`
* **Composed resources:** `sdk.deposits`, `sdk.withdrawals`, `sdk.helpers`
* **Client vs SDK:** The **client** wires RPC/signing, while the **SDK** adds high-level flows (`quote → prepare → create → wait`) and convenience helpers.

## Import

```ts
import { createEthersClient, createEthersSdk } from '@matterlabs/zksync-js/ethers';
```

## Quick Start

```ts
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '@matterlabs/zksync-js/ethers';

const l1 = new JsonRpcProvider(process.env.ETH_RPC!);
const l2 = new JsonRpcProvider(process.env.ZKSYNC_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);

// Example: deposit 0.05 ETH L1 → L2 and wait for L2 execution
const handle = await sdk.deposits.create({
  token: ETH_ADDRESS, // 0x…00 sentinel for ETH supported
  amount: parseEther('0.05'),
  to: await signer.getAddress(),
});

await sdk.deposits.wait(handle, { for: 'l2' });

// Example: resolve core contracts
const { l1NativeTokenVault } = await sdk.helpers.contracts();
```

> [!TIP]
> The SDK composes the client with resources: `deposits`, `withdrawals`, and convenience `helpers`.

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

## `helpers`

Utilities for chain addresses, connected contracts, and L1↔L2 token mapping.

### `addresses() → Promise<ResolvedAddresses>`

Resolve core addresses (Bridgehub, routers, vaults, base-token system).

```ts
const a = await sdk.helpers.addresses();
```

### `contracts() → Promise<{ ...contracts }>`

Return connected `ethers.Contract` instances for all core contracts.

```ts
const c = await sdk.helpers.contracts();
```

### One-off Contract Getters

| Method                 | Returns             | Description                         |
| ---------------------- | ------------------- | ----------------------------------- |
| `l1AssetRouter()`      | `Promise<Contract>` | Connected L1 Asset Router contract. |
| `l1NativeTokenVault()` | `Promise<Contract>` | Connected L1 Native Token Vault.    |
| `l1Nullifier()`        | `Promise<Contract>` | Connected L1 Nullifier contract.    |

```ts
const nullifier = await sdk.helpers.l1Nullifier();
```

### `baseToken(chainId?: bigint) → Promise<Address>`

L1 address of the **base token** for the current (or provided) L2 chain.

```ts
const base = await sdk.helpers.baseToken(); // infers from client.l2
```

### `l2TokenAddress(l1Token: Address) → Promise<Address>`

Return the **L2 token address** for a given L1 token.

* Handles ETH special case (L2 ETH placeholder).
* If token is the chain’s base token, returns the L2 base-token system address.
* Otherwise queries `IL2NativeTokenVault.l2TokenAddress`.

```ts
const l2Crown = await sdk.helpers.l2TokenAddress(CROWN_ERC20_ADDRESS);
```

### `l1TokenAddress(l2Token: Address) → Promise<Address>`

Return the **L1 token** corresponding to an L2 token via `IL2AssetRouter.l1TokenAddress`.
ETH placeholder resolves to canonical ETH.

```ts
const l1Crown = await sdk.helpers.l1TokenAddress(L2_CROWN_ADDRESS);
```

### `assetId(l1Token: Address) → Promise<Hex>`

Get the `bytes32` asset ID via `L1NativeTokenVault.assetId` (handles ETH canonically).

```ts
const id = await sdk.helpers.assetId(CROWN_ERC20_ADDRESS);
```

## Notes & Pitfalls

* **Client first:**
  Always construct the **client** with `{ l1, l2, signer }` before creating the SDK.

* **Chain-derived behavior:**
  Helper methods pull from on-chain data — results vary by network.

* **Error model:**
  All resource methods throw typed errors. Prefer `try*` variants (e.g., `tryCreate`) for structured results.
