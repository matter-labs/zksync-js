# Repository Skills

This directory contains repository-scoped Codex Skills for repeatable SDK workflows.

These skills do not redefine policy. They orchestrate checks using the canonical contributor contracts in [`AGENTS.md`](../../AGENTS.md) and [`llm/README.md`](../../llm/README.md).

## Available Skills

1. `api-surface-gate`
- Purpose: Prevent accidental public API breakage across exports, entrypoints, and exported types.
- Trigger summary: Export map or API-entrypoint/type-surface changes.

2. `adapter-parity-check`
- Purpose: Keep ethers and viem adapter behavior aligned with core abstractions.
- Trigger summary: Core changes or one-adapter-only behavior changes.

3. `sdk-verification-matrix`
- Purpose: Select required verification loops for each change scope.
- Trigger summary: PR completion, CI failures, and test-debugging tasks.

4. `contract-interaction-patterns`
- Purpose: Enforce ABI-derived correctness for contract wrappers/clients and event/log decoding.
- Trigger summary: ABI edits, calldata/method mapping changes, and contract-event decode updates.

## Explicit Invocation

Use explicit invocation when the diff spans multiple risk areas:

- `$api-surface-gate`
- `$adapter-parity-check`
- `$sdk-verification-matrix`
- `$contract-interaction-patterns`

Implicit triggering is defined in each skill's `SKILL.md` and optional `agents/openai.yaml`.
