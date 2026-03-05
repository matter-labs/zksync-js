---
name: api-surface-gate
description: Enforce zksync-js public API safety when diffs touch package exports, typesVersions, entrypoint barrels, or exported core types. Validate checklist, classify compatibility impact, and require docs/changelog alignment.
metadata:
  short-description: Guard export surface changes and API checklist compliance
---

# API Surface Gate

Use this skill to prevent accidental public API drift.

## Use This Skill When

- `package.json` changes in `exports` or `typesVersions`
- `src/index.ts` changes
- `src/core/index.ts` changes
- `src/adapters/ethers/index.ts` changes
- `src/adapters/viem/index.ts` changes
- `src/core/types/**` changes
- Any change appears to add/remove/rename exported symbols

Use explicit invocation as `$api-surface-gate` before merge for export-facing diffs.

## Responsibilities

1. Detect whether API Gate is triggered by touched files.
2. Compare export deltas (added, removed, renamed, type-only changes).
3. Require explicit API checklist acknowledgement:

- `No API change`, or
- `API change` with compatibility and docs/changelog context.

4. Classify compatibility impact using current pre-1.0 release policy.
5. Confirm docs/tests/changelog alignment for externally visible API changes.

## Guardrails

- Do not approve silent export removals or renames.
- Do not allow adapter-specific types to leak into `src/core` entrypoints.
- Do not treat entrypoint changes as internal-only without explicit evidence.

## Output Format

Provide a concise report with:

1. Triggered API files
2. API delta summary
3. Compatibility classification (`non-breaking` or `breaking candidate`)
4. Required follow-ups:

- PR API checklist status
- docs/changelog updates needed
- test coverage updates needed

## References

- [`llm/public-api-contract.md`](../../../llm/public-api-contract.md)
- [`llm/commit-and-pr.md`](../../../llm/commit-and-pr.md)
- [`.github/pull_request_template.md`](../../../.github/pull_request_template.md)
- [`llm/release-contract.md`](../../../llm/release-contract.md)
- [`AGENTS.md`](../../../AGENTS.md)
