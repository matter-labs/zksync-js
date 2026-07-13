# Atomic interop

Atomic L2-to-L2 source-leg planning and submission through the ethers adapter.

## At a glance

* Resource: `sdk.interop`
* Lifecycle: `quote -> prepare -> create -> status`
* Input: `InteropParams | AtomicInteropIntent`
* Result variants: `tryQuote`, `tryPrepare`, `tryCreate`
* Send gate: `interop.enableExperimentalAtomicSend: true` for `prepare` and `create`
* Completion: external; the SDK does not expose `wait`, `finalize`, or `refund`
* Gateway: none

## Configuration

```ts
const sdk = createEthersSdk(client, {
  interop: {
    enableExperimentalAtomicSend: true,
    indexProvider: async ({ flowId, bundleHash, commitValue }) => {
      // Return the current predecessor leaf index, or null to use the bounded on-chain walk.
      return null;
    },
  },
});
```

The optional `AtomicInteropIndexProvider` is useful once the source commitment tree exceeds the SDK's 256-leaf linked-list fallback. Provider results are validated on-chain before use.

## Inputs

### `InteropParams`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `actions` | `InteropAction[]` | Yes | Ordered destination actions. |
| `deadline` | `bigint` | Yes | Absolute `uint64` settlement-layer timestamp. |
| `settlementLayerChainId` | `bigint` | No | Defaults to and must match the configured L1. |
| `execution.only` | `Address` | No | Restricts the destination executor. |
| `fee.useFixed` | `boolean` | No | Selects the fixed protocol fee mode. |
| `txOverrides` | `TxOverrides` | No | Source transaction overrides. |

Enabled actions:

```ts
type InteropAction =
  | { type: 'sendErc20'; token: Address; to: Address; amount: bigint }
  | {
      type: 'call';
      to: Address;
      data: Hex;
      recovery: { protocol: 'IAtomicRecoverable' };
    };
```

The recovery field is a caller declaration; the target contract must actually implement the compatible recovery protocol. Native value is rejected.

## Lifecycle methods

### `quote(dstChain, input): Promise<InteropQuote>`

Returns route, allowance requirements, action totals, protocol fee, deadline, settlement layer, and an optional L2 fee estimate. Passing an intent also returns its `bundleHash` and `flowId`. This method has no side effects and does not require the experimental gate.

`tryQuote` returns the same value in the SDK result envelope.

### `prepare(dstChain, input): Promise<InteropPlan<TransactionRequest>>`

Builds the atomic `sendBundle` plan without sending it. The plan retains the complete intent, exact payload, flow preimage, bundle hash, and current IMT predecessor index.

Hash-affecting ERC-20 allowances must already exist. Use `approve` before `prepare` or `previewLeg`. Requires the experimental gate.

`tryPrepare` returns the same value in the SDK result envelope.

### `create(dstChain, input): Promise<InteropHandle<TransactionRequest>>`

Executes source prerequisites, rechecks allowances, resolves the IMT predecessor, simulates `sendBundle`, and retries once if the predecessor became stale. It validates the emitted bundle against the previewed hash before returning its source transaction metadata and encoded bundle.

With raw `InteropParams`, `create` generates and binds a single-leg flow. With an `AtomicInteropIntent`, it preserves the agreed salt and multi-leg flow. Requires the experimental gate.

`tryCreate` returns the same value in the SDK result envelope.

### `status(dstChain, intentOrHandle): Promise<InteropStatus>`

Accepts an `AtomicInteropIntent` or `InteropHandle`; raw transaction hashes are not accepted. It reads source `LegState` and destination `bundleStatus` without polling or reporting proof readiness.

| Phase | Meaning |
| --- | --- |
| `UNSET` | No source commitment and no destination bundle. |
| `COMMITTED` | The source leg is committed. |
| `VERIFIED` | The destination handler reports the bundle verified. |
| `EXECUTED` | The destination handler reports full execution. |
| `UNBUNDLED` | The destination protocol reports an externally unbundled bundle. |
| `REFUNDABLE` | The source manager reports the leg revertable. |
| `REFUNDED` | The source manager reports the leg reverted. |
| `INCONSISTENT` | Destination execution state coexists with unset/refund source state. |
| `UNKNOWN` | A contract returned an unknown enum value. |

## Coordination methods

### `approve(dstChain, params): Promise<InteropApprovalResult>`

Creates the source token in the native token vault when needed and establishes exact ERC-20 allowances. It returns the requirements and transaction hashes.

### `previewLeg(dstChain, params): Promise<AtomicInteropLegDraft>`

Generates a secure random salt, constructs the exact serializable payload, calls `previewBundleHash`, and returns the local draft plus `{ bundleHash, sourceChainId }` commitment. Hash-affecting allowances must already exist.

### `defineFlow({ legs, deadline, settlementLayerChainId? }): AtomicInteropFlow`

Sorts commitment pairs by bundle hash, rejects duplicate hashes or mixed settlement layers, preserves each source-chain pairing, and computes the canonical protocol `flowId`.

### `bindFlow(draft, flow): AtomicInteropIntent`

Validates that the local draft is a member of the agreed flow and that deadline, settlement layer, bundle hash, and source chain all match.

### `getSettlementDeadline({ afterSeconds }): Promise<bigint>`

Returns `latestL1Block.timestamp + afterSeconds`, validated as a positive `uint64` deadline.

## Retained data

`AtomicInteropIntent`, `InteropPlan`, and `InteropHandle` retain the exact draft, flow, payload, bundle hash, and source transaction metadata required by future proof-backed completion/refund APIs. They are serializable except for the adapter-specific unsigned transactions in a plan.

There are no compatibility wrappers for the removed public-message flow: `verifyBundle`, `getInteropRoot`, unbundling, gateway configuration, and legacy interop proof/finalization types are gone.
