# Deposits

L1 → L2 deposits for ETH and ERC-20 tokens with quote, prepare, create, status, and wait helpers using the **Viem adapter**.

---

## At a Glance

* **Resource:** `sdk.deposits`
* **Common flow:** `quote → create → wait({ for: 'l2' })`
* **Auto-routing:** ETH vs ERC-20 and base-token vs non-base handled automatically
* **Error style:** Throwing methods (`quote`, `prepare`, `create`, `wait`) + safe variants (`tryQuote`, `tryPrepare`, `tryCreate`, `tryWait`)
* **Token mapping:** Use `sdk.tokens` for L1⇄L2 token lookups and assetIds if you need token metadata ahead of time.

## Import

```ts
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Account,
  type Chain,
  type Transport,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '@matterlabs/zksync-js/viem';

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const l1 = createPublicClient({ transport: http(L1_RPC) });
const l2 = createPublicClient({ transport: http(L2_RPC) });
const l1Wallet: WalletClient<Transport, Chain, Account> = createWalletClient({
  account,
  transport: http(L1_RPC),
});

// Initialize
const client = createViemClient({ l1, l2, l1Wallet });
const sdk = createViemSdk(client);
// sdk.deposits → DepositsResource
```

---

## Quick Start

Deposit **0.1 ETH** from L1 → L2 and wait for **L2 execution**:

```ts
const handle = await sdk.deposits.create({
  token: ETH_ADDRESS, // 0x…00 for ETH
  amount: parseEther('0.1'),
  to: account.address,
});

const l2Receipt = await sdk.deposits.wait(handle, { for: 'l2' }); // null only if no L1 hash
```

> [!TIP]
> For UX that never throws, use the `try*` variants and branch on `ok`.

---

## Route Selection (Automatic)

| Route           | Meaning                                  |
| --------------- | ---------------------------------------- |
| `eth-base`      | ETH when L2 base token **is ETH**        |
| `eth-nonbase`   | ETH when L2 base token **≠ ETH**         |
| `erc20-base`    | ERC-20 that **is** the L2 base token     |
| `erc20-nonbase` | ERC-20 that **is not** the L2 base token |

You **do not** pass a route; it’s derived automatically from chain metadata + `token`.

## Method Reference

### `quote(p: DepositParams) → Promise<DepositQuote>`

Estimate the deposit operation (route, approvals, gas hints). Does **not** send transactions.

**Parameters**

| Name              | Type                                          | Required | Description                                                        |
| ----------------- | --------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `token`           | `Address`                                     | ✅        | L1 token address. Use `0x…00` for ETH.                             |
| `amount`          | `bigint`                                      | ✅        | Amount in wei to deposit.                                          |
| `to`              | `Address`                                     | ❌        | L2 recipient address. Defaults to the signer’s address if omitted. |
| `refundRecipient` | `Address`                                     | ❌        | Optional address on L1 to receive refunds for unspent gas.         |
| `l2GasLimit`      | `bigint`                                      | ❌        | Optional manual L2 gas limit override.                             |
| `gasPerPubdata`   | `bigint`                                      | ❌        | Optional custom gas-per-pubdata value.                             |
| `operatorTip`     | `bigint`                                      | ❌        | Optional operator tip (in wei) for priority execution.             |
| `l1TxOverrides`   | [`Eip1559GasOverrides`](#eip1559gasoverrides) | ❌        | Optional EIP-1559 gas settings for the L1 transaction.             |

**Returns:** `DepositQuote`

```ts
const q = await sdk.deposits.quote({
  token: ETH_L1,
  amount: parseEther('0.25'),
  to: account.address,
});
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
```

> [!TIP]
> If `summary.approvalsNeeded` is non-empty (ERC-20), `create()` will automatically include those steps.

### `tryQuote(p) → Promise<{ ok: true; value: DepositQuote } | { ok: false; error }>`

Result-style `quote`.

### `prepare(p: DepositParams) → Promise<DepositPlan<TransactionRequest>>`

Build a plan (ordered steps + unsigned txs) without sending.

**Returns:** `DepositPlan`

```ts
const plan = await sdk.deposits.prepare({ token: ETH_L1, amount: parseEther('0.05'), to });
/*
{
  route,
  summary: DepositQuote,
  steps: [
    { key: "approve:USDC", kind: "approve", tx: TransactionRequest },
    { key: "bridge",       kind: "bridge",  tx: TransactionRequest }
  ]
}
*/
```

### `tryPrepare(p) → Promise<{ ok: true; value: DepositPlan } | { ok: false; error }>`

Result-style `prepare`.

### `create(p: DepositParams) → Promise<DepositHandle<TransactionRequest>>`

Prepares and **executes** all required L1 steps.
Returns a handle with the L1 tx hash and per-step hashes.

**Returns:** `DepositHandle`

```ts
const handle = await sdk.deposits.create({ token, amount, to });
/*
{
  kind: "deposit",
  l1TxHash: Hex,
  stepHashes: Record<string, Hex>,
  plan: DepositPlan
}
*/
```

> [!WARNING]
> If any step reverts, `create()` throws a typed error. Prefer `tryCreate()` to avoid exceptions.

### `tryCreate(p) → Promise<{ ok: true; value: DepositHandle } | { ok: false; error }>`

Result-style `create`.

### `status(handleOrHash) → Promise<DepositStatus>`

Resolve current phase for a deposit.
Accepts either a `DepositHandle` or a raw L1 tx hash.

| Phase         | Meaning                                   |
| ------------- | ----------------------------------------- |
| `UNKNOWN`     | No L1 hash provided                       |
| `L1_PENDING`  | L1 receipt not yet found                  |
| `L1_INCLUDED` | Included on L1; L2 hash not derivable yet |
| `L2_PENDING`  | L2 hash known; waiting for L2 receipt     |
| `L2_EXECUTED` | L2 receipt found with `status === 1`      |
| `L2_FAILED`   | L2 receipt found with `status !== 1`      |

```ts
const s = await sdk.deposits.status(handle);
// { phase, l1TxHash, l2TxHash? }
```

### `wait(handleOrHash, { for: 'l1' | 'l2' }) → Promise<TransactionReceipt | null>`

Block until a checkpoint is reached.

* `{ for: 'l1' }` → L1 receipt (or `null` if no L1 hash)
* `{ for: 'l2' }` → L2 receipt after canonical execution (or `null` if no L1 hash)

```ts
const l1Receipt = await sdk.deposits.wait(handle, { for: 'l1' });
const l2Receipt = await sdk.deposits.wait(handle, { for: 'l2' });
```

### `tryWait(handleOrHash, opts) → Result<TransactionReceipt>`

Result-style `wait`.

---

## End-to-End Examples

### ETH Deposit (Typical)

```ts
const handle = await sdk.deposits.create({
  token: ETH_ADDRESS,
  amount: parseEther('0.1'),
  to: account.address,
});

await sdk.deposits.wait(handle, { for: 'l2' });
```

### ERC-20 Deposit (with Automatic Approvals)

```ts
const handle = await sdk.deposits.create({
  token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC example
  amount: 1_000_000n, // 1 USDC (6 dp)
  to: account.address,
});

const l1Receipt = await sdk.deposits.wait(handle, { for: 'l1' });
```

## Types (Overview)

```ts
export interface DepositParams {
  token: Address; // 0x…00 for ETH
  amount: bigint; // wei
  to?: Address; // L2 recipient
  refundRecipient?: Address;
  l2GasLimit?: bigint;
  gasPerPubdata?: bigint;
  operatorTip?: bigint;
  l1TxOverrides?: Eip1559GasOverrides;
}

export interface Eip1559GasOverrides {
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface DepositQuote {
  route: 'eth-base' | 'eth-nonbase' | 'erc20-base' | 'erc20-nonbase';
  summary: {
    route: 'eth-base' | 'eth-nonbase' | 'erc20-base' | 'erc20-nonbase';
    approvalsNeeded: Array<{ token: Address; spender: Address; amount: bigint }>;
    amounts: {
      transfer: {
        token: Address;
        amount: bigint;
      };
    };
    fees: {
      token: Address;
      maxTotal: bigint;
      mintValue: bigint;
      l1: {
        gasLimit: bigint;
        maxFeePerGas: bigint;
        maxPriorityFeePerGas: bigint;
        maxTotal: bigint;
      };
      l2: {
        total: bigint;
        baseCost: bigint;
        operatorTip: bigint;
        gasLimit: bigint;
        maxFeePerGas: bigint;
        maxPriorityFeePerGas: bigint;
        gasPerPubdata: bigint;
      };
    };
    baseCost: bigint;
    mintValue: bigint;
  };
}

export interface DepositPlan<TTx = TransactionRequest> {
  route: DepositQuote['route'];
  summary: DepositQuote;
  steps: Array<{ key: string; kind: string; tx: TTx }>;
}

export interface DepositHandle<TTx = TransactionRequest> {
  kind: 'deposit';
  l1TxHash: Hex;
  stepHashes: Record<string, Hex>;
  plan: DepositPlan<TTx>;
}

export type DepositStatus =
  | { phase: 'UNKNOWN'; l1TxHash: Hex }
  | { phase: 'L1_PENDING'; l1TxHash: Hex }
  | { phase: 'L1_INCLUDED'; l1TxHash: Hex }
  | { phase: 'L2_PENDING'; l1TxHash: Hex; l2TxHash: Hex }
  | { phase: 'L2_EXECUTED'; l1TxHash: Hex; l2TxHash: Hex }
  | { phase: 'L2_FAILED'; l1TxHash: Hex; l2TxHash: Hex };
```

> [!TIP]
> Prefer the `try*` variants to avoid exceptions and work with structured result objects.

---

## Notes & Pitfalls

* **ETH sentinel:** Always use the canonical `0x…00` address when passing ETH as `token`.
* **Receipts timing:** `wait({ for: 'l2' })` resolves after canonical L2 execution — may take longer than L1 inclusion.
* **Gas hints:** `suggestedL2GasLimit` and `gasPerPubdata` are informational; advanced users can override via the prepared plan.
