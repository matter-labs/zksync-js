# Finalization (Withdrawals)

**Withdrawals from ZKsync (L2)** only complete on **Ethereum (L1)** after you explicitly call `finalize`.

When withdrawing from ZKsync (L2) back to Ethereum (L1), **funds are *not* automatically released on L1** after your L2 transaction is included.

Withdrawals are a **two-step process**:

1. **Initiate on L2** — call `withdraw()` (via the SDK’s `create`) to start the withdrawal.
   This burns or locks funds on L2 and emits logs; **funds are still unavailable on L1**.
2. **Finalize on L1** — call **`finalize(l2TxHash)`** to release funds on L1.
   This submits an L1 transaction; only then does your ETH or token balance increase on Ethereum.

> [!WARNING]
> If you **never finalize**, your funds remain locked — visible as “ready to withdraw,” but unavailable on L1.
> Anyone can finalize on your behalf, but typically **you** should do it.

## Why Finalization Matters

* **Funds remain locked** until finalized.
* **Anyone can finalize** — typically the withdrawer does.
* **Finalization costs L1 gas** — budget for it.

## Finalization Methods

| Method                                     | Purpose                                                     | Returns               |
| ------------------------------------------ | ----------------------------------------------------------- | --------------------- |
| `withdrawals.status(h \| l2TxHash)`        | Snapshot phase (`UNKNOWN` → `FINALIZED`)                    | `WithdrawalStatus`    |
| `withdrawals.wait(h \| l2TxHash, { for })` | Block until a checkpoint (`'l2' \| 'ready' \| 'finalized'`) | Receipt or `null`     |
| `withdrawals.finalize(l2TxHash)`           | **Send** the L1 finalize transaction                        | `{ status, receipt }` |

> [!NOTE]
> All methods accept either a **handle** (from `create`) or a **raw L2 transaction hash**.
> If you only have the hash, you can still finalize.

## Phases

| Phase               | Meaning                                           |
| ------------------- | ------------------------------------------------- |
| `UNKNOWN`           | Handle doesn’t contain an L2 hash yet.            |
| `L2_PENDING`        | L2 transaction not yet included.                  |
| `PENDING`           | L2 included, but not yet ready to finalize on L1. |
| `READY_TO_FINALIZE` | Finalization on L1 would succeed now.             |
| `FINALIZED`         | Finalized on L1; funds released.                  |

## Examples

<details>
<summary><code>finalize-by-handle.ts</code></summary>

```ts
// 1) Create on L2
const withdrawal = await sdk.withdrawals.create({
  token: ETH_ADDRESS,
  amount: parseEther('0.1'),
  to: myAddress,
});

// 2) Wait until finalizable (no side effects)
await sdk.withdrawals.wait(withdrawal, { for: 'ready', pollMs: 5500 });

// 3) Finalize on L1
const { status, receipt } = await sdk.withdrawals.finalize(withdrawal.l2TxHash);

console.log(status.phase); // "FINALIZED"
console.log(receipt?.transactionHash); // L1 finalize tx hash
```

</details>

<details>
<summary><code>finalize-by-hash.ts</code></summary>

```ts
// If you only have the L2 tx hash:
const l2TxHash = '0x...';

// Optionally confirm readiness first
const s = await sdk.withdrawals.status(l2TxHash);
if (s.phase !== 'READY_TO_FINALIZE') {
  await sdk.withdrawals.wait(l2TxHash, { for: 'ready', timeoutMs: 30 * 60_000 });
}

// Then finalize
const { status, receipt } = await sdk.withdrawals.finalize(l2TxHash);
```

</details>


Prefer "no-throw" variants in UI/services that need explicit flow control.

```ts
const r = await sdk.withdrawals.tryFinalize(l2TxHash);
if (!r.ok) {
  console.error('Finalize failed:', r.error);
} else {
  console.log('Finalized on L1:', r.value.receipt?.transactionHash);
}
```

## Operational Tips

* **Gate UX with phases:** Display a **Finalize** button only when `status.phase === 'READY_TO_FINALIZE'`.
* **Polling cadence:** `wait(..., { for: 'ready' })` defaults to ~**5500 ms**. Adjust with `pollMs` as needed.
* **Timeouts:** Use `timeoutMs` for long windows and fall back to `status(...)` to keep UIs responsive.
* **Receipts may be `null`:** `wait(..., { for: 'finalized' })` can resolve to `null` if finalized but receipt is unavailable; show an L1 explorer link based on the submitted transaction hash.

## Common Errors

| Type       | Description                                        | Action                   |
| ---------- | -------------------------------------------------- | ------------------------ |
| `RPC`      | RPC or network hiccup (`ZKsyncError: RPC`)         | Retry with backoff.      |
| `INTERNAL` | Decode or internal issue (`ZKsyncError: INTERNAL`) | Capture logs and report. |

---

## See Also

* [Status vs Wait](../overview/status-vs-wait.md)
* [Withdrawals Guide](../guides/withdrawals.md)
