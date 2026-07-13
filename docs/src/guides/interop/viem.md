# Atomic interop (viem)

`sdk.interop` creates one atomic source leg from one ZKsync chain to another. One SDK instance owns one source leg. There is no gateway configuration or gateway lifecycle.

> [!WARNING]
> Atomic sends are experimental while proof-backed completion and refund tooling remains external. Set `enableExperimentalAtomicSend: true` to use `prepare` or `create`.

## Supported actions

| Action | Availability | Requirement |
| --- | --- | --- |
| ERC-20 transfer | Enabled | Source-chain allowances must cover the exact bundle payload. |
| Arbitrary call | Enabled with recovery | The destination contract must implement the declared `IAtomicRecoverable` recovery behavior. |
| Native transfer/value | Disabled | Timeout recovery is not yet guaranteed for an ordinary recipient. |

Every leg needs an absolute `uint64` settlement-layer deadline. The configured L1 is the settlement layer unless `settlementLayerChainId` is supplied and matches it.

## One leg

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:imports}}
```

Create the SDK with the experimental send gate, derive a deadline from the latest L1 block, and build the leg parameters:

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:main}}
```

The intent keeps the generated salt, exact preview payload, bundle hash, and flow preimage stable between `quote`, `prepare`, and `create`. Calling `create(dstChain, params)` directly is also supported; it creates a single-leg flow and handles required approvals internally.

## Multiple legs

Each participant independently calls `approve` and `previewLeg` through an SDK connected to their own source chain. Exchange the serializable `{ bundleHash, sourceChainId }` commitments, agree on one deadline and settlement layer, then derive the same canonical flow:

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:multi-leg}}
```

`defineFlow` sorts the paired commitments by bundle hash, rejects duplicate hashes, and computes the protocol `flowId`. Each participant binds only their local draft and independently calls `quote`, `prepare`, and `create` with that intent.

## Status

`status(dstChain, intentOrHandle)` is a non-blocking observation. It reads the source `LegState` and destination `bundleStatus`; it does not claim that a proof, executor, or refund transaction is ready.

`wait`, `finalize`, and `refund` are intentionally absent until the SDK has a production proof source and documented external execution path. `verifyBundle`, root polling, and unbundling are not part of the atomic intent API.

## Result style

`tryQuote`, `tryPrepare`, and `tryCreate` return `{ ok, value }` or `{ ok, error }`:

```ts
{{#include ../../../snippets/viem/guides/interop-guide.test.ts:try-create}}
```

See [Interop SDK Reference (viem)](../../sdk-reference/viem/interop.md) for exact signatures and status phases.
