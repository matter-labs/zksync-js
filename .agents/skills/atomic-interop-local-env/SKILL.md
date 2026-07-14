---
name: atomic-interop-local-env
description: Start, inspect, register, test, and stop the pinned zksync-os-server v32.0 two-chain local environment used for zksync-js atomic interop work. Use when provisioning the atomic interop stack, checking its prerequisites or RPC topology, running the upstream atomic-swap smoke test, preparing SDK interop E2Es, or diagnosing local proof and chain-registration failures. Do not use for ordinary unit tests or non-atomic single-chain E2Es.
---

# Atomic Interop Local Env

Provision the pinned, L1-settled two-chain preset without reimplementing it. Use the helper for deterministic checks and registration; keep the upstream launcher in a managed terminal session so its own cleanup trap remains authoritative.

## Fixed Contract

- Pin `zksync-os-server` to commit `17f425162f3538c40b26e353a4c7f8d539592af4`.
- Use `local-chains/v32.0/multi_chain` only.
- Treat chain `6565` (`http://127.0.0.1:3050`) and chain `6566` (`http://127.0.0.1:3051`) as direct L1-settling chains. There is no gateway.
- Use L1 at `http://127.0.0.1:8545`.
- Read [references/pinned-environment.md](references/pinned-environment.md) when debugging topology, registration, proofs, or expected success.

## Safety Rules

1. Never reset, clean, or switch an existing dirty `zksync-os-server` checkout.
2. If the checkout is missing or not at the pinned commit, ask before downloading data or creating a dedicated clone/worktree.
3. Never embed, print, persist, or add a private key to shell history. Require `PRIVATE_KEY` or `ATOMIC_INTEROP_PRIVATE_KEY` in the caller's environment only for the smoke driver.
4. Start the upstream launcher in a foreground PTY/session and retain its session ID. Stop that exact session with Ctrl-C; never use `pkill`, port-based killing, or broad process matches.
5. Default to teardown after a test or diagnostic run. Leave the environment running only when the user explicitly asks for a start-only session.
6. Do not claim SDK E2E success from the upstream smoke driver. It proves the environment and protocol path, not adapter behavior.

## Resolve The Checkout

Use an explicit path argument or `ZKSYNC_OS_SERVER_DIR`. For a new dedicated checkout, obtain approval and fetch the exact commit rather than a moving branch:

```bash
git init <approved-path>
git -C <approved-path> remote add origin https://github.com/matter-labs/zksync-os-server.git
git -C <approved-path> fetch --depth 1 origin 17f425162f3538c40b26e353a4c7f8d539592af4
git -C <approved-path> checkout --detach FETCH_HEAD
export ZKSYNC_OS_SERVER_DIR=<approved-path>
```

Do not run these commands when a suitable checkout already exists.

## Run The Workflow

Set the helper path from the `zksync-js` repository root:

```bash
ENV_HELPER=.agents/skills/atomic-interop-local-env/scripts/atomic-interop-env.sh
```

### 1. Check prerequisites

```bash
bash "$ENV_HELPER" doctor "$ZKSYNC_OS_SERVER_DIR"
```

Resolve missing `cargo`, Foundry (`anvil` and `cast`), `curl`, `gzip`, `npm`, or `realpath` before continuing. The helper also rejects a dirty or incorrectly pinned checkout.

### 2. Start and wait

Start this command through a PTY-capable execution tool and retain its session ID:

```bash
bash "$ENV_HELPER" start "$ZKSYNC_OS_SERVER_DIR"
```

While that session remains active, use a separate command session:

```bash
bash "$ENV_HELPER" wait
```

The release build can take several minutes. Poll the active start session for build failures while `wait` checks the three RPCs.

### 3. Register both directions

Registration is required once per Anvil session and is idempotent through prechecks:

```bash
bash "$ENV_HELPER" register "$ZKSYNC_OS_SERVER_DIR"
bash "$ENV_HELPER" status
```

The helper sends from an unlocked local Anvil account. Override it with `ATOMIC_INTEROP_L1_SENDER` only when the preset exposes a different funded, unlocked address.

### 4. Establish the environment baseline

Run the upstream self-contained driver before attributing a live failure to this SDK:

```bash
read -rsp 'Funded local test key: ' PRIVATE_KEY
printf '\n'
export PRIVATE_KEY
bash "$ENV_HELPER" smoke "$ZKSYNC_OS_SERVER_DIR"
unset PRIVATE_KEY
```

`smoke` runs `npm ci` unless `ATOMIC_INTEROP_SKIP_INSTALL=1`, then expects the upstream completion line documented in the reference. Network approval may be required for the first install.

### 5. Run SDK-focused tests

Print the non-secret endpoint variables with:

```bash
bash "$ENV_HELPER" env
```

Pass those values and a funded local test key directly to the focused ethers and viem atomic interop test commands present on the current branch. Inspect `package.json` first; do not invent an E2E command or re-enable obsolete gateway/public-message tests. Record upstream-smoke and SDK-adapter results separately.

### 6. Tear down

Send Ctrl-C to the retained start session and wait for `run_local.sh` to report that all services stopped. Then confirm that this command fails because the endpoints are unavailable:

```bash
bash "$ENV_HELPER" status
```

If the start session ID is unavailable, do not guess which processes to terminate. Report the active ports and ask the user to stop the terminal that owns `run_local.sh`.

## Diagnostic Order

1. `doctor`: toolchain, commit, checkout cleanliness, and preset artifacts.
2. `wait`: L1 and both expected L2 chain IDs.
3. `register`: non-zero reciprocal `baseTokenAssetId` values.
4. `smoke`: upstream send, proof RPCs, root import, and atomic execution.
5. SDK test: adapter-specific planning, sending, receipt decoding, and status behavior.

Keep failures assigned to the earliest failing layer. Include the command, failing layer, relevant log path, and whether teardown completed.
