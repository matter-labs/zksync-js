# Quickstart (ethers): ETH Deposit (L1 → L2)

This guide will get you from zero to a working **ETH deposit from Ethereum to ZKsync (L2)** in minutes using the **ethers** adapter. 🚀

You'll set up your environment, write a short script to make a deposit, and run it.

## 1. Prerequisites

- You have [Bun](https://bun.sh/) installed.
- You have an L1 wallet (e.g., Sepolia testnet) funded with some ETH to pay for gas and the deposit.

## 2. Installation & Setup

First, install the necessary packages.

```bash
bun install @matterlabs/zksync-js ethers dotenv
```

Next, create a `.env` file in your project's root directory to store your private key and RPC endpoints. **Never commit this file to Git.**

**`.env` file:**

```env
# Your funded L1 wallet private key (e.g., from MetaMask)
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# RPC endpoints
L1_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_ID
L2_RPC_URL="ZKSYNC-OS-TESTNET-RPC"
```

## 3. The Deposit Script

The following script will connect to the networks, create a deposit transaction, send it, and wait for it to be confirmed on both L1 and L2.

Save this code as `deposit-ethers.ts`:

```ts
import 'dotenv/config'; // Load environment variables from .env
{{#include ../../snippets/ethers/quickstart/quickstart.test.ts:quickstart-imports}}

{{#include ../../snippets/ethers/quickstart/quickstart.test.ts:quickstart-main}}

main().catch((error) => {
  console.error('An error occurred:', error);
  process.exit(1);
});
```

## 4. Run the Script

Execute the script using `bun`.

```bash
bun run deposit-ethers.ts
```

You should see output confirming the L1 transaction, the wait periods, and finally the successful L2 verification.

## 5. Troubleshooting

- **Insufficient funds on L1:** Make sure your wallet has enough ETH on L1 to cover both the deposit amount (`0.001` ETH) and the L1 gas fees.
- **Invalid `PRIVATE_KEY`:** Ensure it’s a 64-character hex string, prefixed with `0x`.
- **Stuck waiting for L2:** This can take a few minutes. If it takes too long, check that your `L2_RPC_URL` is correct and the network is operational.
