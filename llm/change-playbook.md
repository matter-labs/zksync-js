# Change Playbook

> Standard change flow with API gate, generated-file handling, and verification triggers.

## Before You Start

1. Read [`repo-context.md`](./repo-context.md).
2. Read [`architecture-adapters-and-core.md`](./architecture-adapters-and-core.md) when touching `src/core` or adapters.
3. Read [`public-api-contract.md`](./public-api-contract.md) for export/type safety.
4. Identify exact files to modify.

## Standard Workflow

### 1. Restate Objective and Constraints

State:

- what will change
- what must not change
- whether API Gate is expected to trigger

### 2. Scope the Diff

- Keep changes minimal and local.
- Avoid opportunistic refactors.
- Preserve existing patterns and naming.

### 3. Apply API Gate When Triggered

API Gate trigger paths:

- `package.json` (`exports` or `typesVersions`)
- `src/index.ts`
- `src/core/index.ts`
- `src/adapters/ethers/index.ts`
- `src/adapters/viem/index.ts`
- `src/core/types/**`
- any newly exported type from those entrypoints

If triggered, include API Change Checklist in PR description, including explicit `No API change` when applicable.

### 4. Handle Generated Files Correctly

- Never edit generated files directly: `src/adapters/ethers/typechain/**` and `typechain/**`.
- Regenerate using: `bun run types`.
- If regeneration changes outputs, include generated diffs in the same PR.

### 5. Run Verification Loops

Always run fast loop:

```bash
bun run lint
bun run format:check
bun run test
bun run typecheck
```

Conditional loops:

- Run `bun run test:e2e:ethers` for ethers adapter behavior changes.
- Run `bun run test:e2e:viem` for viem adapter behavior changes.
- Run `bun run docs:build` when docs/navigation files change.

### 6. Update Docs and Contracts

For public behavior or API surface changes:

- Update user docs and/or snippets where applicable.
- Update `llm` contracts (`public-api-contract.md`, `release-contract.md`, etc.) when contributor policy changes.
- Update docs navigation (`docs/src/SUMMARY.md`) for new pages.

## Common Change Types

### Bug Fix

1. Identify failing behavior.
2. Add or update a targeted test.
3. Implement fix with minimal diff.
4. Run required loops.
5. Update docs if observable behavior changed.

### API Surface Change

1. Modify API source files intentionally.
2. Verify export/type changes.
3. Complete API Change Checklist in PR.
4. Update relevant docs/contracts and changelog context.

### Resource Expansion

See [`resource-patterns.md`](./resource-patterns.md).
