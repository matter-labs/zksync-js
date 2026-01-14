# AGENTS.md – LLM Contributing Guide

> **Tool-agnostic entrypoint for AI assistants working on zksync-js.**  
> For detailed guidance, see [`llm/README.md`](./llm/README.md).

---

## Quick Rules

| Do | Don't |
|---|---|
| Read context before editing | Invent commands or scripts |
| Make small, incremental changes | Refactor unrelated code |
| Preserve existing patterns | Change public APIs without updating docs/tests |
| Use adapter library's encoders/decoders | Hand-roll ABI encode/decode |
| Keep `core/` adapter-agnostic | Import `viem`/`ethers` in `core/` |

---

## Hard Repo Rules

> [!CAUTION]
> These rules are **non-negotiable**.

1. **`core/` must NEVER depend on adapters**  
   - No imports from `viem`, `ethers`, or adapter-specific types in `core/`
   - All shared logic and types live in `core/`

2. **Adapters are translation layers only**  
   - `src/adapters/viem/` and `src/adapters/ethers/` translate between `core` abstractions and library calls
   - Use each library's native ABI encoders/decoders

3. **No logic duplication across adapters**  
   - If logic is duplicated, extract to `core/` as adapter-agnostic utilities

---

## How to Work Here

### Before You Start
1. Read [`llm/repo-context.md`](./llm/repo-context.md) for architecture overview
2. Identify which files you'll touch
3. Check existing patterns in similar files

### Standard Workflow
1. Restate objective + constraints
2. Identify files to modify
3. Implement with **minimal diff**
4. Run required scripts: `bun run lint`, `bun run format:check`, `bun run test`, `bun run typecheck`
5. Update docs if needed: `docs/src/SUMMARY.md`, SDK reference, LLM docs

### Definition of Done
- [ ] `bun run lint` passes
- [ ] `bun run format:check` passes
- [ ] `bun run test` passes
- [ ] `bun run typecheck` passes
- [ ] Docs updated (if public-facing change)
- [ ] No secrets committed

---

## When Unsure

```
Is it about core/ vs adapters?
  → Read llm/architecture-adapters-and-core.md

Is it about adding a new resource?
  → Read llm/resource-patterns.md

Is it about code style?
  → Read llm/style-guide.md

Can't find a script?
  → Check package.json, never invent commands

Still unsure?
  → Ask the user, don't guess
```

---

## Minimal Diff Principle

- Change only what's necessary
- Don't refactor adjacent code
- Don't rename unless explicitly required
- Don't "improve" unrelated code

---

## Key Resources

| Topic | File |
|---|---|
| Index & navigation | [`llm/README.md`](./llm/README.md) |
| Repo architecture | [`llm/repo-context.md`](./llm/repo-context.md) |
| Core vs Adapters | [`llm/architecture-adapters-and-core.md`](./llm/architecture-adapters-and-core.md) |
| Adding resources | [`llm/resource-patterns.md`](./llm/resource-patterns.md) |
| Style guide | [`llm/style-guide.md`](./llm/style-guide.md) |
| Testing & quality | [`llm/testing-and-quality.md`](./llm/testing-and-quality.md) |
| Commit/PR checklist | [`llm/commit-and-pr.md`](./llm/commit-and-pr.md) |
| Security | [`llm/security-and-secrets.md`](./llm/security-and-secrets.md) |
