# Change Playbook

> **Standard workflow for making changes to zksync-js.**

---

## Before You Start

1. Read [`repo-context.md`](./repo-context.md) for architecture overview
2. Read [`architecture-adapters-and-core.md`](./architecture-adapters-and-core.md) if touching core/ or adapters
3. Identify which files you'll modify

---

## Standard Workflow

### 1. Restate Objective + Constraints

Before any change, clearly state:

- What you're trying to accomplish
- Any constraints (e.g., "don't change public API", "ethers only")

### 2. Identify Files to Touch

List all files you expect to modify. Consider:

- Core types (`core/types/`)
- Core utilities (`core/utils/`)
- Adapter implementations (`adapters/viem/`, `adapters/ethers/`)
- Tests (`__tests__/`, `*.test.ts`)
- Docs (`docs/src/`)
- Docs examples tests (`docs/snippets`)

### 3. Implement with Minimal Diff

- Change only what's necessary
- Don't refactor adjacent code
- Don't rename unless required
- Don't "improve" unrelated code
- Follow existing patterns exactly
- Don't add hardcoded code examples directly in any markdown docs.
  Use imported code snippets from tests in `docs/snippets` in markdown docs files

### 4. Run Required Scripts

```bash
bun run lint
bun run format:check
bun run test
bun run typecheck
```

All must pass before considering done.

### 5. Update Docs

If your change affects public API or behavior:

- [ ] Update `docs/src/SUMMARY.md` (if adding new pages)
- [ ] Update SDK reference docs (`docs/src/sdk-reference/viem/`, `docs/src/sdk-reference/ethers/`)
- [ ] Add/update quickstart guide if new resource (follow deposits/withdrawals structure)
- [ ] Update the relevant docs examples tests in `docs/snippets`
- [ ] Update LLM docs (`llm/`) if applicable

---

## Minimal Diff Principle

| Do                            | Don't                                           |
| ----------------------------- | ----------------------------------------------- |
| Change only required lines    | Reformat entire file                            |
| Fix the specific bug          | Refactor "while you're there"                   |
| Add the specific feature      | Add "nice to have" improvements                 |
| Update affected tests         | Rewrite unrelated tests                         |
| Update affected docs snippets | Add hardcoded code examples into markdown files |

---

## Common Change Types

### Bug Fix

1. Identify the bug location
2. Write a failing test (if possible)
3. Fix the bug
4. Verify tests pass
5. Update docs markdown files (`docs/src`) and relevant snippets (`docs/snippets`) if behavior changed

### Add Method to Existing Resource

1. Add type to `core/types/flows/<resource>.ts`
2. Implement in both adapters
3. Add tests
4. Update SDK reference docs markdown files (`docs/src/sdk-reference`) and relevant snippets (`docs/snippets`)

### Add New Resource

See [`resource-patterns.md`](./resource-patterns.md) for full checklist.

### Update Types

1. Modify types in `core/types/`
2. Update all usages in adapters
3. Update tests
4. Update docs if public-facing
