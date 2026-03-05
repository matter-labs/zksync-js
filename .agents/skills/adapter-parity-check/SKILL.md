---
name: adapter-parity-check
description: Validate ethers and viem adapter parity for zksync-js when core or adapter behavior changes. Detect mismatches, enforce documented exceptions, and protect core-to-adapter contract consistency.
metadata:
  short-description: Detect and gate ethers/viem behavior drift
---

# Adapter Parity Check

Use this skill to keep adapter behavior consistent with core abstractions.

## Use This Skill When

- Any change touches `src/core/**`
- Only one adapter is modified under `src/adapters/ethers/**` or `src/adapters/viem/**`
- A flow/resource change may alter user-visible behavior in adapters

Use explicit invocation as `$adapter-parity-check` when parity risk is high.

## Responsibilities

1. Build a touched-resource map from the diff.
2. Compare adapter parity for affected resources:

- method availability
- input/return shape expectations
- error semantics
- flow/status handling behavior

3. Identify mismatches and whether they are intentional.
4. Enforce explicit exception protocol when parity is intentionally divergent.

## Exception Protocol

If parity is intentionally not achieved, require an `Adapter Parity Exception` note with:

1. Rationale
2. Scope
3. Consumer impact
4. Follow-up issue or timeline
5. Docs note when user-facing behavior differs

## Guardrails

- Keep `src/core` adapter-agnostic.
- Do not accept one-adapter behavior changes without parity assessment.
- Do not hide parity exceptions in code comments only; require PR-level declaration.

## Output Format

Provide:

1. Parity matrix for touched resources
2. Mismatches found
3. Exception status (`none`, `required`, `provided`)
4. Required follow-up actions

## References

- [`llm/architecture-adapters-and-core.md`](../../../llm/architecture-adapters-and-core.md)
- [`llm/repo-context.md`](../../../llm/repo-context.md)
- [`llm/change-playbook.md`](../../../llm/change-playbook.md)
- [`AGENTS.md`](../../../AGENTS.md)
