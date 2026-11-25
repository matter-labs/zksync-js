# Atomic interop

Helpers for **atomic interop**, where several interop bundles (the _legs_ of a _flow_) either all
execute or are all refunded. They compute what the contracts compute (flow ids, commit values,
bundle hashes), encode what the contracts take (the `atomicBundle` attribute, `InteropBundle` bytes,
finality proofs), and read the node's proofs. They make no network calls; pair them with the
`zks_getImt*` methods on [`client.zks`](./rpc.md) and with your library's contract calls.

> [!INFO]
> These helpers follow the atomic-interop contracts of era-contracts
> (`l1-contracts/contracts/atomic-interop/`, as on the `draft/v0.36.0` branch). On chains that deploy
> them, every L2 → L2 bundle is a leg of an atomic flow.

## How a flow works

1. **Agree on the legs.** Each participant builds its leg (an `InteropBundle`) and learns its hash,
   for example from `InteropCenter.previewBundleHash`, which reverts with `InteropPreviewHash(hash)`.
   Every participant derives the same flow from the legs' hashes and source chains, a deadline on the
   settlement layer, and the settlement layer's chain id.
2. **Commit.** Each sender sends its leg with `sendBundle`, adding the `atomicBundle(preimage,
   lowNullifierIndex)` bundle attribute. The send inserts the leg's _commit value_ into the source
   chain's commitment tree.
3. **Execute or refund.** Once every leg is in a batch the settlement layer included by the
   deadline, anyone executes each leg on its destination with
   `IL2InteropHandler.executeAtomicBundle(bundleData, finality)`. If one leg is provably absent past
   the deadline, anyone calls `AtomicFlowManager.authorizeRefund` with the absence proof, then
   `claimRefund` for each committed leg.

## Imports

The pure helpers and types are in the core entrypoint (`@matterlabs/zksync-js/core`); the helpers
that ABI-encode come from your adapter (`@matterlabs/zksync-js/viem` or
`@matterlabs/zksync-js/ethers`, where they are named `createEthersAtomicInteropHelpers` and
`createEthersAttributesResource`).

```ts
{{#include ../../../snippets/core/atomic-interop.test.ts:imports}}
```

## Building a flow

```ts
{{#include ../../../snippets/core/atomic-interop.test.ts:build-flow}}
```

`buildFlow` sorts the legs the way the contracts require (ascending bundle hash, each with its source
chain) and rejects what the `AtomicFlowManager` would reject: an unsupported version, more than
`MAX_ATOMIC_FLOW_LEGS` (8) legs, a repeated leg, or a deadline beyond `uint64`. A flow that fails
here would otherwise revert the send.

| Helper (adapter)                          | What it returns                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `buildFlow({ deadline, settlementLayerChainId, legs })` | `AtomicFlow`: `{ flowId, preimage }`                                   |
| `computeFlowId(preimage)`                 | `keccak256(abi.encode(preimage))`                                                    |
| `assertFlow(flow)`                        | Throws unless `flow.flowId` is the hash of `flow.preimage`                           |
| `computeCommitValue(flowId, bundleHash)`  | `keccak256(abi.encode(ATOMIC_COMMIT_LEAF_TAG, flowId, bundleHash))`, as 32-byte hex   |
| `legIndex(flow, bundleHash)`              | The leg's position in the flow, as `authorizeRefund` takes it                        |
| `buildFinalityProof(flow, proofs)`        | `AtomicFinalityProof`: the flow and one inclusion proof per leg, in leg order        |
| `encodeInteropBundle(bundle)`             | `abi.encode(bundle)`: the `bundleData` that `executeAtomicBundle` and `claimRefund` take |
| `decodeInteropBundle(bundleData)`         | The `InteropBundle` the bytes encode                                                 |
| `bundleHashOf(bundle)`                    | The bundle's hash                                                                    |

| Helper (core)                                  | What it returns                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `sortAtomicLegs(legs)`                         | The legs in contract order, and where each came from                    |
| `buildAtomicFlowPreimage(input)`               | The canonical `AtomicFlowPreimage`                                      |
| `validateAtomicFlowPreimage(preimage)`         | Throws when the contracts would reject the preimage                     |
| `computeBundleHash(bundleData)`                | `keccak256(bundleData)`                                                 |
| `computeInteropBundleSalt(sender, salt)`       | The bundle's `interopBundleSalt` field: `keccak256(abi.encodePacked(sender, salt))` |
| `readSettlementLayerReference(settlementProof)` | Where a proof ends on the settlement layer                             |
| `toOnchainImtProof(proof, sourceChainId)`      | The on-chain `ImtProof` for a proof the node returned                   |

The attributes resource (`createViemAttributesResource()` / `createEthersAttributesResource()`)
encodes the bundle attributes, including `atomicBundle(preimage, lowNullifierIndex)` and
`interopBundleSalt(salt)`. `formatInteropEvmChainAddress(chainId, address)` formats the ERC-7930
address that a bundle's `unbundlerAddress` defaults to.

## Checking a leg someone else built

Bundle bytes that another participant sends you are only as good as what they do. Bind them to the
hash in the flow, then decode and check them against what was agreed:

```ts
{{#include ../../../snippets/core/atomic-interop.test.ts:check-bundle}}
```

## Proving and executing

`client.zks.getImtInclusionProof(commitValue, commitBlock)` returns a leg's inclusion proof once its
batch is executed on the settlement layer. `toOnchainImtProof` adds the source chain, and
`buildFinalityProof` puts the proofs in the order the contracts take them:

```ts
{{#include ../../../snippets/core/atomic-interop.test.ts:finality}}
```

The destination chain can only check a proof after it imported the settlement layer's interop root
that the proof ends at. `readSettlementLayerReference` reads which root that is, and when the
settlement layer included the leg's batch:

```ts
{{#include ../../../snippets/core/atomic-interop.test.ts:settlement-reference}}
```

> [!WARNING]
> The values `readSettlementLayerReference` returns are only as trustworthy as the proof: the
> contracts authenticate them when they verify it. Use them to decide when to submit a proof, not as
> evidence on their own.

## Refunds

For the refund path, `client.zks.getImtNonInclusionProof(commitValue, batchNumber)` proves a leg's
commit value absent at the start of a batch. Pick a batch the settlement layer included after the
deadline (check it with `readSettlementLayerReference`), convert the proof with `toOnchainImtProof`,
and call `AtomicFlowManager.authorizeRefund(flow, legIndex(flow, missingLeg), absence)`; then
`claimRefund(flowId, bundleData)` for each committed leg. `legState(flowId, bundleHash)` reports
where a leg is (`ATOMIC_LEG_STATE`).

## Contracts and constants

| Export                                  | Value                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `L2_ATOMIC_FLOW_MANAGER_ADDRESS`        | `0x…010014`                                                               |
| `L2_INTEROP_COMMITMENT_TREE_ADDRESS`    | `0x…010012`                                                               |
| `L2_INTEROP_HANDLER_ADDRESS`            | `0x…01000e`                                                               |
| `L2_INTEROP_CENTER_ADDRESS`             | `0x…01000d`                                                               |
| `ATOMIC_FLOW_PREIMAGE_VERSION`          | `0x01`                                                                    |
| `ATOMIC_COMMIT_LEAF_TAG`                | `bytes4(keccak256("AtomicInterop.commit.v1"))`                            |
| `MAX_ATOMIC_FLOW_LEGS`                  | `8`                                                                       |
| `ATOMIC_LEG_STATE`, `INTEROP_BUNDLE_STATUS` | The `legState` and `bundleStatus` enums                               |

The ABIs are in the `abi` namespace: `IAtomicFlowManagerABI` (`authorizeRefund`, `claimRefund`,
`legState`, `requireFlowFinalized`, the `FlowCommitted` and `FlowRefunded` events),
`IL2InteropHandlerABI` (`executeAtomicBundle`, `verifyAtomicBundle`, `bundleStatus`),
`IAtomicInteropErrorsABI` (the custom errors, which both adapters decode in reverts), and
`IInteropCenterABI` (`previewBundleHash`, `isInteropBundleSaltUsed`).
