---
name: sdk-verification-matrix
description: Determine and enforce the correct zksync-js verification loops (fast, adapter e2e, docs) based on changed files, PR completion state, and CI failure context.
metadata:
  short-description: Route changes to required verification loops
---

# SDK Verification Matrix

Use this skill to standardize change verification and avoid incomplete test coverage.

## Use This Skill When

- Preparing a PR for review/merge
- Triage is needed for CI failures
- A task asks for test verification or debugging

Use explicit invocation as `$sdk-verification-matrix` at PR finalization and on CI failures.

## Verification Policy

### Fast Loop (always required)

Run:

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
```

### Adapter Loop (conditional)

Run:

```bash
bun run test:e2e:ethers
bun run test:e2e:viem
```

Trigger rules:

1. If `src/core/**` changed: run both adapter e2e suites.
2. If only `src/adapters/ethers/**` changed: run ethers e2e; run viem e2e if parity impact is plausible.
3. If only `src/adapters/viem/**` changed: run viem e2e; run ethers e2e if parity impact is plausible.

### Docs Loop (conditional)

Run:

```bash
bun run docs:build
```

Trigger when changes touch:

- `docs/**`
- `AGENTS.md`
- `llm/**`

## Responsibilities

1. Determine required loops from touched files and task context.
2. State command set with rationale before execution.
3. Report pass/fail/blocker outcomes by loop.
4. Escalate missing-loop risk when required suites were skipped.

## Output Format

Provide:

1. Required loops and why
2. Commands run (or required to run)
3. Loop status (`pass`, `fail`, `blocked`)
4. Failures with reproduction command

## References

- [`llm/testing-and-quality.md`](../../../llm/testing-and-quality.md)
- [`llm/change-playbook.md`](../../../llm/change-playbook.md)
- [`package.json`](../../../package.json)
- [`AGENTS.md`](../../../AGENTS.md)
