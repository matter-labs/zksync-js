# Adapters: `viem` & `ethers`

The SDK is designed to work _with_ the tools you already know and love. It's not a standalone library, but rather an extension that plugs into your existing `viem` or `ethers.js` setup.

Think of it like a power adapter 🔌. You have your device (`viem` or `ethers` client), and this SDK adapts it to work seamlessly with zkSync's unique features. You bring your own client, and the SDK enhances it.

## Why an Adapter Model?

This approach offers several key advantages:

- ✅ **Bring Your Own Stack:** You don't have to replace your existing setup. The SDK integrates directly with the `viem` clients (`PublicClient`, `WalletClient`) or `ethers` providers and signers you're already using.
- 📚 **Familiar Developer Experience (DX):** You continue to handle connections, accounts, and signing just as you always have.
- 🧩 **Lightweight & Focused:** The SDK remains small and focused on one thing: providing a robust API for ZKsync-specific actions like deposits and withdrawals.

## Installation

First, install the core SDK, then add the adapter that matches your project's stack.

```bash
# For viem users
npm install @matterlabs/zksync-js viem

# For ethers.js users
npm install @matterlabs/zksync-js ethers
```

## How to Use

The SDK extends your existing client. Configure **viem** or **ethers** as you normally would, then pass them into the adapter’s client factory and create the SDK surface.

### viem (public + wallet client)

```ts
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '@matterlabs/zksync-js/viem';
import { ETH_ADDRESS } from '@matterlabs/zksync-js/core';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
const l1Wallet = createWalletClient({ account, transport: http(process.env.L1_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet });
const sdk = createViemSdk(client);

const params = {
  amount: parseEther('0.01'),
  to: account.address,
  token: ETH_ADDRESS,
} as const;

const handle = await sdk.deposits.create(params);
await sdk.deposits.wait(handle, { for: 'l2' }); // funds available on L2
```

### ethers (providers + signer)

```ts
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '@matterlabs/zksync-js/ethers';
import { ETH_ADDRESS } from '@matterlabs/zksync-js/core';

const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2 = new JsonRpcProvider(process.env.L2_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = await createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);

const params = {
  amount: parseEther('0.01'),
  to: await signer.getAddress(),
  token: ETH_ADDRESS,
} as const;

const handle = await sdk.deposits.create(params);
await sdk.deposits.wait(handle, { for: 'l2' }); // funds available on L2
```

---

## Key Principles

- **No Key Management:** The SDK never asks for or stores private keys. All signing operations are delegated to the `viem` `WalletClient` or `ethers` `Signer` you provide.
- **API Parity:** Both adapters expose the exact same API. The code you write to call `client.deposits.quote()` is identical whether you're using `viem` or `ethers`.
- **Easy Migration:** Because the API is the same, switching your project from `ethers` to `viem` (or vice versa) is incredibly simple. You only need to change the initialization code.
