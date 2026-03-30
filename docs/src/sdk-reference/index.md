# Introduction

Public, typed API surface for **ZKsyncOS** — *Incorruptible Financial Infrastructure.*

## What Is This?

The **zksync-js** provides lightweight adapters for **ethers** and **viem** to build L1 ↔ L2 flows — **deposits** and **withdrawals** — with a small, focused API. You’ll work with:

* Adapter-level **Clients** (providers/wallets, resolved addresses, convenience contracts)
* High-level **SDKs** (resources for deposits/withdrawals plus tokens and contracts)
* ZKsync-specific **RPC** helpers (`client.zks.*`)
* A consistent, typed **Error model** (`ZKsyncError`, `try*` results)

## Quick Start

<details>
<summary><strong>Ethers Example</strong></summary>

```ts
{{#include ../../snippets/ethers/reference/sdk.test.ts:ethers-import}}
{{#include ../../snippets/ethers/reference/sdk.test.ts:eth-import}}
{{#include ../../snippets/ethers/reference/sdk.test.ts:sdk-import}}

{{#include ../../snippets/ethers/reference/sdk.test.ts:init-sdk}}

{{#include ../../snippets/ethers/reference/sdk.test.ts:erc-20-address}}

{{#include ../../snippets/ethers/reference/sdk.test.ts:basic-sdk}}
```

</details>

<details>
<summary><strong>Viem Example</strong></summary>

```ts
{{#include ../../snippets/viem/reference/sdk.test.ts:sdk-import}}
{{#include ../../snippets/viem/reference/sdk.test.ts:viem-import}}
{{#include ../../snippets/viem/reference/sdk.test.ts:eth-import}}

{{#include ../../snippets/viem/reference/sdk.test.ts:init-sdk}}

{{#include ../../snippets/viem/reference/sdk.test.ts:erc-20-address}}

{{#include ../../snippets/viem/reference/sdk.test.ts:basic-sdk}}
```

</details>

## What's Documented Here

| Area                                                | Description                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [**Ethers · Client**](./ethers/client.md)           | Low-level handle: providers/signer, resolved addresses, convenience contracts, ZK RPC access. |
| [**Ethers · SDK**](./ethers/sdk.md)                 | High-level deposits/withdrawals plus token and contract resources.                            |
| [**Ethers · Contracts**](./ethers/contracts.md)     | Resolved addresses and connected core contracts.                                               |
| [**Ethers · Deposits**](./ethers/deposits.md)       | L1 → L2 flow with quote, prepare, create, status, and wait.                                   |
| [**Ethers · Withdrawals**](./ethers/withdrawals.md) | L2 → L1 flow with quote, prepare, create, status, wait, and finalize.                         |
| [**Viem · Client**](./viem/client.md)               | `PublicClient` / `WalletClient` integration, resolved addresses, contracts, ZK RPC access.    |
| [**Viem · SDK**](./viem/sdk.md)                     | Same high-level surface as ethers, typed to viem contracts.                                   |
| [**Viem · Contracts**](./viem/contracts.md)         | Resolved addresses and connected core contracts.                                               |
| [**Viem · Deposits**](./viem/deposits.md)           | L1 → L2 flow with quote, prepare, create, status, and wait.                                   |
| [**Viem · Withdrawals**](./viem/withdrawals.md)     | L2 → L1 flow with quote, prepare, create, status, wait, and finalize.                         |
| [**Core · ZK RPC**](./core/rpc.md)                  | ZKsync-specific RPC: `getBridgehubAddress`, `getBytecodeSupplierAddress`, `getBlockMetadataByNumber`, `getL2ToL1LogProof`. |
| [**Core · Error model**](./core/errors.md)          | Typed `ZKsyncError` envelope and `try*` result helpers.                                       |

---

## Notes & Conventions

> [!NOTE]
> **Standard `eth_*` RPC** should always be performed through your chosen base library (**ethers** or **viem**).
> The SDK only adds **ZKsync-specific** RPC methods via `client.zks.*` (e.g. `getBridgehubAddress`, `getBytecodeSupplierAddress`, `getBlockMetadataByNumber`, `getGenesis`).

* Every resource method has a **`try*` variant** (e.g. `tryCreate`) that returns a result object instead of throwing.
  When errors occur, the SDK throws **`ZKsyncError`** with a stable, structured envelope (see [Error model](./core/errors.md)).
* Address resolution comes from on-chain lookups and well-known constants, but can be overridden in the client constructor for forks/tests.
