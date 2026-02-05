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
{{#include ../../snippets/viem/overview/adapter.test.ts:viem-adapter-imports}}

{{#include ../../snippets/viem/overview/adapter-basic.test.ts:init-viem-adapter}}

{{#include ../../snippets/viem/overview/adapter.test.ts:viem-deposit}}
```

### ethers (providers + signer)

```ts
{{#include ../../snippets/ethers/overview/adapter.test.ts:ethers-adapter-imports}}

{{#include ../../snippets/ethers/overview/adapter-basic.test.ts:init-ethers-adapter}}

{{#include ../../snippets/ethers/overview/adapter.test.ts:ethers-deposit}}
```

---

## Key Principles

- **No Key Management:** The SDK never asks for or stores private keys. All signing operations are delegated to the `viem` `WalletClient` or `ethers` `Signer` you provide.
- **API Parity:** Both adapters expose the exact same API. The code you write to call `client.deposits.quote()` is identical whether you're using `viem` or `ethers`.
- **Easy Migration:** Because the API is the same, switching your project from `ethers` to `viem` (or vice versa) is incredibly simple. You only need to change the initialization code.
