# Deposits (ethers)

A fast path to deposit **ETH / ERC-20** from L1 → ZKsync (L2) using the **ethers** adapter.

## Prerequisites

- A funded **L1** account (gas + amount).
- RPC URLs: `L1_RPC_URL`, `L2_RPC_URL`.
- Installed: `@matterlabs/zksync-js` + `ethers`.

---

## Parameters (quick reference)

| Param             | Required | Meaning                                |
| ----------------- | -------- | -------------------------------------- |
| `token`           | Yes      | `ETH_ADDRESS` or ERC-20 address        |
| `amount`          | Yes      | BigInt/wei (e.g. `parseEther('0.01')`) |
| `to`              | Yes      | L2 recipient address                   |
| `l2GasLimit`      | No       | L2 execution gas cap                   |
| `gasPerPubdata`   | No       | Pubdata price hint                     |
| `operatorTip`     | No       | Optional tip to operator               |
| `refundRecipient` | No       | L2 address to receive fee refunds      |
| `l1TxOverrides`   | No       | L1 tx overrides (e.g. gasLimit, maxFeePerGas, maxPriorityFeePerGas)     |

> ERC-20 deposits may require an L1 `approve()`. **`quote()`** surfaces required steps.

---

## Fast path (one-shot)

```ts
{{#include ../../../snippets/ethers/guides/deposit-eth-guide.test.ts:imports}}

{{#include ../../../snippets/ethers/guides/deposit-eth-guide.test.ts:main}}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- `create()` prepares **and** sends.
- `wait(..., { for: 'l1' })` ⇒ included on L1.
- `wait(..., { for: 'l2' })` ⇒ executed on L2 (funds available).

## Inspect & customize (quote → prepare → create)

**1. Quote (no side-effects)**
Preview fees/steps and whether an approve is required.

```ts
{{#include ../../../snippets/ethers/guides/deposit-eth-guide.test.ts:quote}}
```

**2. Prepare (build txs, don’t send)**
Get `TransactionRequest[]` for signing/UX.

```ts
{{#include ../../../snippets/ethers/guides/deposit-eth-guide.test.ts:prepare}}
```

**3. Create (send)**
Use defaults, or send your prepared txs if you customized.

```ts
{{#include ../../../snippets/ethers/guides/deposit-eth-guide.test.ts:create}}
```

## Track progress (status vs wait)

**Non-blocking snapshot**

```ts
{{#include ../../../snippets/ethers/guides/deposit-eth-guide.test.ts:status}}
```

**Block until checkpoint**

```ts
{{#include ../../../snippets/viem/overview/adapter.test.ts:deposit-wait}}
```

---

## Error handling patterns

**Exceptions**

```ts
{{#include ../../../snippets/viem/overview/adapter.test.ts:try-deposit}}
```

**No-throw style**

Every method has a `try*` variant (e.g. `tryQuote`, `tryPrepare`, `tryCreate`).  
These never throw—so you don’t need a `try/catch`. Instead they return:

- `{ ok: true, value: ... }` on success
- `{ ok: false, error: ... }` on failure

This is useful for **UI flows** or **services** where you want explicit control over errors.

```ts
{{#include ../../../snippets/viem/overview/adapter.test.ts:try-create}}
```

## Troubleshooting

- **Stuck at L1:** check L1 gas and RPC health.
- **No L2 execution:** verify L2 RPC; re-check `status()` (should move to `L2_EXECUTED`).
- **L2 failed:** `status.phase === 'L2_FAILED'` → inspect revert info via your error envelope/logs.

## See also

- [Status vs Wait](../../concepts/status-vs-wait.md)
- [ZKsync RPC Helpers](../../zks/methods.md)
