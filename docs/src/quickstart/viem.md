# Quickstart (viem): ETH Deposit (L1 → L2)

This guide gets you to a working **ETH deposit from Ethereum to ZKsync (L2)** using the **viem** adapter.

You’ll set up your environment, write a short script, and run it.

## 1. Prerequisites

- You have [Bun](https://bun.sh/) (or Node + tsx) installed.
- You have an **L1 wallet** funded with ETH to cover the deposit amount **and** L1 gas.

## 2. Installation & Setup

Install packages:

```bash
bun install @matterlabs/zksync-js viem dotenv
# or: npm i @matterlabs/zksync-js viem dotenv
```

Create an `.env` in your project root (never commit this):

```env
# Your funded L1 private key (0x + 64 hex)
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# RPC endpoints
L1_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_ID
L2_RPC_URL=ZKSYNC-OS-TESTNET-RPC
```

## 3. The Deposit Script

Save as `deposit-viem.ts`:

```ts
{{#include ../../snippets/viem/quickstart/quickstart.test.ts:quickstart-imports}}

{{#include ../../snippets/viem/quickstart/quickstart.test.ts:quickstart-main}}

main().catch((error) => {
  console.error('An error occurred:', error);
  process.exit(1);
});
```

## 4. Run the Script

```bash
bun run deposit-viem.ts
# or with tsx:
# npx tsx deposit-viem.ts
```

You’ll see logs for the L1 transaction, then L2 execution, and a final status snapshot.

## 5. Troubleshooting

- **Insufficient funds on L1:** Ensure enough ETH for the deposit **and** L1 gas.
- **Invalid `PRIVATE_KEY`:** Must be `0x` + 64 hex chars.
- **Stuck at `wait(..., { for: 'l2' })`:** Verify `L2_RPC_URL` and network health; check `sdk.deposits.status(handle)` to see the current phase.
- **ERC-20 deposits:** May require an L1 `approve()`; `quote()` will surface required steps.
