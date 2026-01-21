# SDK Consumer Guide

> **For AI agents building applications (UIs, bots, services) that use zksync-js.**

---

## Installation

```bash
# For viem users
npm install @matterlabs/zksync-js viem

# For ethers users
npm install @matterlabs/zksync-js ethers
```

---

## Quick Start

### Viem

```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { createViemClient, createViemSdk } from '@matterlabs/zksync-js/viem';
import { ETH_ADDRESS } from '@matterlabs/zksync-js/core';

const l1 = createPublicClient({ transport: http('L1_RPC_URL') });
const l2 = createPublicClient({ transport: http('L2_RPC_URL') });
const l1Wallet = createWalletClient({ account, transport: http('L1_RPC_URL') });

const client = createViemClient({ l1, l2, l1Wallet });
const sdk = createViemSdk(client);
```

### Ethers

```typescript
import { JsonRpcProvider, Wallet } from 'ethers';
import { createEthersClient, createEthersSdk } from '@matterlabs/zksync-js/ethers';
import { ETH_ADDRESS } from '@matterlabs/zksync-js/core';

const l1Provider = new JsonRpcProvider('L1_RPC_URL');
const l2Provider = new JsonRpcProvider('L2_RPC_URL');
const signer = new Wallet(process.env.PRIVATE_KEY!, l1Provider);

const client = await createEthersClient({ l1Provider, l2Provider, signer });
const sdk = createEthersSdk(client);
```

---

## Available Resources

| Resource          | Description                           |
| ----------------- | ------------------------------------- |
| `sdk.deposits`    | L1 → L2 deposits (ETH and ERC-20)     |
| `sdk.withdrawals` | L2 → L1 withdrawals with finalization |
| `sdk.tokens`      | Token address mapping helpers         |
| `sdk.contracts`   | Contract address getters              |

---

## Method Patterns

Most resources follow this pattern:

| Method       | Purpose                     | Throws |
| ------------ | --------------------------- | ------ |
| `quote`      | Get estimated costs/fees    | Yes    |
| `tryQuote`   | Same as `quote`, no-throw   | No     |
| `prepare`    | Prepare transaction data    | Yes    |
| `tryPrepare` | Same as `prepare`, no-throw | No     |
| `create`     | Execute the operation       | Yes    |
| `tryCreate`  | Same as `create`, no-throw  | No     |
| `status`     | Check current status        | Yes    |
| `wait`       | Wait for a specific state   | Yes    |
| `tryWait`    | Same as `wait`, no-throw    | No     |
| `finalize`   | Complete multi-step flow    | Yes    |

---

## Error Handling for UIs

**Prefer `try*` methods** for UI applications:

```typescript
// ✅ Recommended for UIs
const result = await sdk.deposits.tryCreate({ token, amount, to });

if (result.ok) {
  showSuccess(`Deposit started: ${result.value.hash}`);
} else {
  showError(result.error.message);
}
```

```typescript
// ❌ Requires try-catch
try {
  const handle = await sdk.deposits.create({ token, amount, to });
  showSuccess(`Deposit started: ${handle.hash}`);
} catch (error) {
  showError(error.message);
}
```

---

## Common Flows

### Deposit (L1 → L2)

```typescript
// 1. Quote (optional - for showing fees)
const quote = await sdk.deposits.quote({ token, amount, to });
/*
{
  route: "eth-base" | "eth-nonbase" | "erc20-base" | "erc20-nonbase",
  summary: {
    route,
    approvalsNeeded: [{ token, spender, amount }],
    amounts: {
      transfer: { token, amount }
    },
    fees: {
      token,
      maxTotal,
      mintValue,
      l1: { gasLimit, maxFeePerGas, maxPriorityFeePerGas, maxTotal },
      l2: { total, baseCost, operatorTip, gasLimit, maxFeePerGas, maxPriorityFeePerGas, gasPerPubdata }
    },
    baseCost,
    mintValue
  }
}
*/

// 2. Execute deposit
const handle = await sdk.deposits.create({ token, amount, to });

// 3. Wait for L2 confirmation
await sdk.deposits.wait(handle, { for: 'l2' });
```

### Withdrawal (L2 → L1)

```typescript
// 1. Quote (optional - for showing fees)
const quote = await sdk.withdrawals.quote({ token, amount, to });

// 2. Initiate withdrawal on L2
const handle = await sdk.withdrawals.create({ token, amount, to });

// 3. Wait for L2 confirmation
await sdk.withdrawals.wait(handle, { for: 'l2' });

// 4. Wait for finalization (can take hours/days)
await sdk.withdrawals.wait(handle, { for: 'finalized' });

// 5. Finalize on L1
await sdk.withdrawals.finalize(handle);
```

### Check Token Addresses

```typescript
// Get L2 address for an L1 token
const l2Address = await sdk.tokens.toL2Address(l1TokenAddress);

// Get L1 address for an L2 token
const l1Address = await sdk.tokens.toL1Address(l2TokenAddress);

// Check if token is the base token
const isBase = await sdk.tokens.isBaseToken(tokenAddress);
```

### Get Bridgehub Instance

```typescript
const bridgehub = await sdk.contracts.bridgehub();
```

### Get Contract Address

```typescript
const a = await sdk.contracts.addresses();
/*
{
  bridgehub,
  l1AssetRouter,
  l1Nullifier,
  l1NativeTokenVault,
  l2AssetRouter,
  l2NativeTokenVault,
  l2BaseTokenSystem
}
*/
```

---

## UI Best Practices

### Show Loading States

```typescript
setLoading(true);
const result = await sdk.deposits.tryCreate({ token, amount, to });
setLoading(false);

if (!result.ok) {
  setError(result.error.message);
  return;
}

// Start polling for status
pollForCompletion(result.value);
```

### Handle Long Waits

Withdrawals can take hours/days to finalize. Don't block the UI:

```typescript
// Start withdrawal
const handle = await sdk.withdrawals.create({ token, amount, to });
saveWithdrawalState(handle); // Persist for later

// Show user the status
const status = await sdk.withdrawals.status(handle);
showStatus(status); // 'pending' | 'ready_to_finalize' | 'finalized'
```

### Use Quotes for Fee Display

```typescript
const quote = await sdk.deposits.tryQuote({ token, amount, to });
if (quote.ok) {
  displayFees({
    l1Gas: quote.value.l1GasLimit,
    l2Gas: quote.value.l2GasLimit,
    totalCost: quote.value.totalCost,
  });
}
```

---

## Documentation

- [User Book](https://matter-labs.github.io/zksync-js/latest/)
- [Quickstart](https://matter-labs.github.io/zksync-js/latest/quickstart/index.html)
- [Guides](https://matter-labs.github.io/zksync-js/latest/guides/index.html)
