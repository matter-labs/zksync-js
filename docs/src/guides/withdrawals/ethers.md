# Withdrawals (ethers)

A fast path to withdraw **ETH / ERC-20** from ZKsync (L2) → Ethereum (L1) using the **ethers** adapter.

Withdrawals are a **two-step process**:

1. **Initiate** on L2.
2. **Finalize** on L1 to release funds.

## Prerequisites

- A funded **L2** account to initiate the withdrawal.
- A funded **L1** account for finalization.
- RPC URLs: `L1_RPC_URL`, `L2_RPC_URL`.
- Installed: `@matterlabs/zksync-js` + `ethers`.

---

## Parameters (quick reference)

| Param             | Required | Meaning                                           |
| ----------------- | -------- | ------------------------------------------------- |
| `token`           | Yes      | `ETH_ADDRESS` or ERC-20 address                   |
| `amount`          | Yes      | BigInt/wei (e.g. `parseEther('0.01')`)            |
| `to`              | Yes      | L1 recipient address                              |
| `refundRecipient` | No       | L2 address to receive fee refunds (if applicable) |
| `l2TxOverrides`   | No       | L2 tx overrides (e.g. gasLimit, maxFeePerGas, maxPriorityFeePerGas)     |

## Fast path (one-shot)

```ts
{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:imports}}

{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:main}}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- `create()` prepares **and** sends the L2 withdrawal.
- `wait(..., { for: 'l2' })` ⇒ included on L2.
- `wait(..., { for: 'ready' })` ⇒ ready for finalization.
- `finalize(l2TxHash)` ⇒ required to release funds on L1.

## Inspect & customize (quote → prepare → create)

**1. Quote (no side-effects)**

```ts
{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:quote}}
```

**2. Prepare (build txs, don’t send)**

```ts
{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:prepare}}
```

**3. Create (send)**

```ts
{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:create}}
```

## Track progress (status vs wait)

**Non-blocking snapshot**

```ts
{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:status}}
```

**Block until checkpoint**

```ts
{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:wait-for-l2}}
{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:wait-for-ready}}
```

## Finalization (required step)

```ts
{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:wfinalize}}
```

## Error handling patterns

**Exceptions**

```ts
{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:try-catch-create}}
```

**No-throw style**

Use `try*` methods to avoid exceptions. They return `{ ok, value }` or `{ ok, error }`.
Perfect for UIs or services that prefer explicit flow control.

```ts
{{#include ../../../snippets/ethers/guides/withdrawals-eth-guide.test.ts:tryCreate}}
```

## Troubleshooting

- **Never reaches READY_TO_FINALIZE:** proofs may not be available yet.
- **Finalize reverts:** ensure enough L1 gas; inspect revert info.
- **Finalized but no receipt:** `wait(..., { for: 'finalized' })` may return `null`; retry or rely on `finalize()` result.

---

## See also

- [Status vs Wait](../../concepts/status-vs-wait.md)
- [Finalization](../../concepts/finalization.md)
- [ZKsync RPC Helpers](../../zks/methods.md)
