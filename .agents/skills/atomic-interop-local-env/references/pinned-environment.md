# Pinned Atomic Interop Environment

Authority: [zksync-os-server `ATOMIC_SWAP.md` at `17f4251`](https://github.com/matter-labs/zksync-os-server/blob/17f425162f3538c40b26e353a4c7f8d539592af4/local-chains/v32.0/multi_chain/ATOMIC_SWAP.md).

## Topology

| Layer          | Chain ID | RPC                     | Settlement |
| -------------- | -------: | ----------------------- | ---------- |
| Local Anvil L1 |    31337 | `http://127.0.0.1:8545` | n/a        |
| L2 A           |     6565 | `http://127.0.0.1:3050` | L1         |
| L2 B           |     6566 | `http://127.0.0.1:3051` | L1         |

This preset contains no gateway. Both L2 chains settle directly on the same in-memory L1.

Atomic predeploys used by the upstream driver:

| Address   | Contract                  |
| --------- | ------------------------- |
| `0x10012` | `L2InteropCommitmentTree` |
| `0x10014` | `AtomicFlowManager`       |
| `0x1000d` | `InteropCenter`           |
| `0x1000e` | `InteropHandler`          |

The L2 Bridgehub used for reciprocal base-token registration is `0x10002`.

## Required Setup

1. Run `./run_local.sh ./local-chains/v32.0/multi_chain` from the pinned server checkout.
2. Wait for chain IDs `6565` and `6566` on ports `3050` and `3051`.
3. Resolve `Bridgehub.chainRegistrationSender()` on L1.
4. Submit `registerChain(6566, 6565)` and `registerChain(6565, 6566)` once per Anvil session.
5. Poll `baseTokenAssetId(6566)` on chain 6565 and `baseTokenAssetId(6565)` on chain 6566 until both are non-zero.

The skill helper performs steps 2 through 5 and skips already-complete registration directions.

## Proof Capabilities

The upstream atomic swap relies on these server RPCs:

- `zks_getImtLowNullifierIndex(value, block)`
- `zks_getImtInclusionProof(commitValue, block)`
- `zks_getL2ToL1LogProof(txHash, index, "messageRoot")`

For each leg, the driver commits the atomic leaf on the source chain, obtains the IMT and message-root proofs, waits for the destination chain to import the settlement-layer interop root, and calls `InteropHandler.executeAtomicBundle`.

## Success Criteria

The upstream baseline succeeds only when:

- both source legs reach `Committed`;
- both destination executions reach `FullyExecuted` (`BundleStatus = 2`);
- both wrapped token mints land; and
- the driver prints `Atomic swap complete: both legs executed atomically.`

Keep this result separate from SDK adapter acceptance. The upstream driver uses its own vendored ethers helpers, so it validates the environment and protocol proof path but does not validate `zksync-js` planning, encoding, receipt parsing, or status mapping.

## Operational Notes

- `run_local.sh` builds the Rust server in release mode before launching Anvil and both chains.
- The start command stays in the foreground and owns cleanup through its signal trap.
- Logs should be kept outside the server checkout so checkout cleanliness remains a useful reproducibility check.
- The smoke driver requires a funded disposable local key. Supply it through the process environment and never add it to this repository or a generated env file.
- A first smoke run installs the pinned `atomic-swap/package-lock.json` dependencies and may require network access.
