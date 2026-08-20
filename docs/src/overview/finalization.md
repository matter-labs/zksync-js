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

## Protocol Versions (v31 vs v32)

Protocol **v32** replaced both ends of the withdrawal flow, and neither change is backwards
compatible:

| Step         | Protocol v31 and below                            | Protocol v32 and above                              |
| ------------ | ------------------------------------------------- | --------------------------------------------------- |
| Initiate ETH | `L2BaseToken.withdraw(l1Receiver)`                | `InteropCenter.sendBundle(...)`                     |
| Initiate ERC-20 | `L2AssetRouter.withdraw(assetId, transferData)` | `InteropCenter.sendBundle(...)`                     |
| Finalize     | `L1Nullifier.finalizeDeposit(params)`             | `L1InteropHandler.executeBundle(bundle, proof)`     |
| Check status | `L1Nullifier.isWithdrawalFinalized(...)`          | `L1InteropHandler.bundleStatus(bundleHash)`         |

From v32 on, a withdrawal *is* an interop bundle: a single indirect call to the L2 asset router,
destined for the L1 chain. Base-token and ERC-20 withdrawals share that one path.

**The SDK handles this for you.** It detects the chain's withdrawal protocol once per client and
picks the matching path, so `create`, `status`, `wait` and `finalize` behave identically on both.
Detection uses, in order:

1. The chain's protocol version, read from its `ChainTypeManager`. Note this is the *per-chain*
   version, not the CTM's latest — during a rolling ecosystem upgrade the two differ.
2. If that cannot be read, whether the v32-only `InteropAttributeParser` (`0x…010015`) has bytecode
   on L2. That contract is force-deployed on every v32 chain, EraVM and ZKsync OS alike.

If neither probe can run (for example the chain's Bridgehub is not reachable from your L1 provider),
force it explicitly:

```ts
const sdk = createEthersSdk(client, { withdrawals: { protocol: 'interop-bundle' } });
```

> [!WARNING]
> A withdrawal **initiated** before a chain's v32 upgrade cannot be finalized after it: v32 removed
> `L1Nullifier.finalizeDeposit` entirely, and the pre-upgrade L2→L1 message is not an interop bundle.
> Finalize in-flight withdrawals before the upgrade lands. The SDK reports this case with an explicit
> error rather than an opaque revert.

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
{{#include ../../snippets/viem/overview/adapter.test.ts:withdraw-short}}
```

</details>

<details>
<summary><code>finalize-by-hash.ts</code></summary>

```ts
// If you only have the L2 tx hash:
const l2TxHash = '0x...';

{{#include ../../snippets/viem/overview/adapter.test.ts:withdraw-by-hash}}
```

</details>

Prefer "no-throw" variants in UI/services that need explicit flow control.

```ts
{{#include ../../snippets/viem/overview/adapter.test.ts:withdraw-try-finalize}}
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
