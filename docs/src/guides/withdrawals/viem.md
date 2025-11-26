# Withdrawals (viem)

A fast path to withdraw **ETH / ERC-20** from ZKsync (L2) → Ethereum (L1) using the **viem** adapter.

Withdrawals are a **two-step process**:

1. **Initiate** on L2.
2. **Finalize** on L1 to release funds.

## Prerequisites

- A funded **L2** account to initiate the withdrawal.
- A funded **L1** account for finalization.
- RPC URLs: `L1_RPC_URL`, `L2_RPC_URL`.
- Installed: `@matterlabs/zksync-js` + `viem`.

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
{{#include ../../../snippets/viem/withdrawals-eth.ts}}
```

- `create()` prepares **and** sends the L2 withdrawal.
- `wait(..., { for: 'l2' })` ⇒ included on L2.
- `wait(..., { for: 'ready' })` ⇒ ready for finalization.
- `finalize(l2TxHash)` ⇒ required to release funds on L1.

## Inspect & customize (quote → prepare → create)

**1. Quote (no side-effects)**

Preview fees/steps and whether extra approvals are required.

```ts
const quote = await sdk.withdrawals.quote(params);
```

**2. Prepare (build txs, don’t send)**

Get `TransactionRequest[]` for signing/UX.

```ts
const plan = await sdk.withdrawals.prepare(params);
```

**3. Create (send)**

Use defaults, or send your prepared txs if you customized.

```ts
const handle = await sdk.withdrawals.create(params);
```

## Track progress (status vs wait)

**Non-blocking snapshot**

```ts
const s = await sdk.withdrawals.status(handle /* or l2TxHash */);
// 'UNKNOWN' | 'L2_PENDING' | 'PENDING' | 'READY_TO_FINALIZE' | 'FINALIZED'
```

**Block until checkpoint**

```ts
const l2Receipt = await sdk.withdrawals.wait(handle, { for: 'l2' });
await sdk.withdrawals.wait(handle, { for: 'ready' }); // becomes finalizable
```

## Finalization (required step)

To actually release funds on L1, call `finalize`. Note
the transaction needs to be ready for finalization.

```ts
const result = await sdk.withdrawals.finalize(handle.l2TxHash);
console.log('Finalization status:', result.status.phase);
```

## Error handling patterns

**Exceptions**

```ts
try {
  const handle = await sdk.withdrawals.create(params);
} catch (e) {
  // normalized error envelope (type, operation, message, context, optional revert)
}
```

**No-throw style**

Every method has a `try*` variant (e.g. `tryQuote`, `tryPrepare`, `tryCreate`, `tryFinalize`).
These never throw—so you don’t need `try/catch`. Instead they return:

- `{ ok: true, value: ... }` on success
- `{ ok: false, error: ... }` on failure

This is useful for **UI flows** or **services** where you want explicit control over errors.

```ts
const r = await sdk.withdrawals.tryCreate(params);

if (!r.ok) {
  console.error('Withdrawal failed:', r.error);
} else {
  const handle = r.value;
  const f = await sdk.withdrawals.tryFinalize(handle.l2TxHash);
  if (!f.ok) {
    console.error('Finalize failed:', f.error);
  } else {
    console.log('Withdrawal finalized on L1:', f.value.receipt?.transactionHash);
  }
}
```

## Troubleshooting

- **Never reaches READY_TO_FINALIZE:** proofs may not be available yet; poll `status()` or `wait(..., { for: 'ready' })`.
- **Finalize fails:** ensure you have L1 gas and check revert info in the error envelope.

## See also

- [Status vs Wait](../../concepts/status-vs-wait.md)
- [Finalization](../../concepts/finalization.md)
- [ZKsync RPC Helpers](../../zks/methods.md)
