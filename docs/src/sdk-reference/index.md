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
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk, ETH_ADDRESS } from '@matterlabs/zksync-js/ethers';

const l1 = new JsonRpcProvider(process.env.ETH_RPC!);
const l2 = new JsonRpcProvider(process.env.ZKSYNC_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

// Low-level client + high-level SDK
const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);

// Deposit 0.05 ETH L1 → L2 and wait for L2 execution
const handle = await sdk.deposits.create({
  token: ETH_ADDRESS,
  amount: parseEther('0.001'),
  to: await signer.getAddress(),
});

const l2Receipt = await sdk.deposits.wait(handle, { for: 'l2' });

// ZKsync-specific RPC is available via client.zks
const bridgehub = await client.zks.getBridgehubAddress();
```

</details>

<details>
<summary><strong>Viem Example</strong></summary>

```ts
import {
  createPublicClient,
  http,
  createWalletClient,
  privateKeyToAccount,
  parseEther,
} from 'viem';
import { createViemClient, createViemSdk, ETH_ADDRESS } from '@matterlabs/zksync-js/viem';

const account = privateKeyToAccount(process.env.PRIVATE_KEY! as `0x${string}`);
const l1 = createPublicClient({ transport: http(process.env.ETH_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.ZKSYNC_RPC!) });
const l1Wallet = createWalletClient({ account, transport: http(process.env.ETH_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet });
const sdk = createViemSdk(client);

const handle = await sdk.withdrawals.create({
  token: ETH_ADDRESS,
  amount: parseEther('0.001'),
  to: account.address, // L1 recipient
});

await sdk.withdrawals.wait(handle, { for: 'l2' }); // inclusion on L2
const { status } = await sdk.withdrawals.finalize(handle.l2TxHash); // finalize on L1

const bridgehub = await client.zks.getBridgehubAddress();
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
| [**Core · ZK RPC**](./core/rpc.md)                  | ZKsync-specific RPC: `getBridgehubAddress`, `getL2ToL1LogProof`, enhanced receipts.           |
| [**Core · Error model**](./core/errors.md)          | Typed `ZKsyncError` envelope and `try*` result helpers.                                       |

---

## Notes & Conventions

> [!NOTE]
> **Standard `eth_*` RPC** should always be performed through your chosen base library (**ethers** or **viem**).
> The SDK only adds **ZKsync-specific** RPC methods via `client.zks.*` (e.g. `getBridgehubAddress`, `getL2ToL1LogProof`, `getGenesis`).

* Every resource method has a **`try*` variant** (e.g. `tryCreate`) that returns a result object instead of throwing.
  When errors occur, the SDK throws **`ZKsyncError`** with a stable, structured envelope (see [Error model](./core/errors.md)).
* Address resolution comes from on-chain lookups and well-known constants, but can be overridden in the client constructor for forks/tests.
