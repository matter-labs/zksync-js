# CLAUDE.md – Claude-Specific Instructions

> **Claude entrypoint for zksync-js.**  
> This file supplements [`AGENTS.md`](./AGENTS.md) with Claude-specific notes.

---

## Start Here

1. Read [`AGENTS.md`](./AGENTS.md) for rules and workflow
2. Read [`llm/README.md`](./llm/README.md) for detailed guidance
3. Follow the standard workflow before making changes

---

## Claude-Specific Notes

- **Use tools proactively**: Read files, run scripts, verify changes
- **Prefer small commits**: Make incremental, focused changes
- **Verify before claiming done**: Run `bun run lint`, `bun run test`, `bun run typecheck`
- **Ask when uncertain**: Don't guess at conventions or commands

---

## Key Files

- [`AGENTS.md`](./AGENTS.md) – Primary rules (read first)
- [`llm/README.md`](./llm/README.md) – Detailed navigation
- [`llm/architecture-adapters-and-core.md`](./llm/architecture-adapters-and-core.md) – Core/adapter boundary
- [`llm/resource-patterns.md`](./llm/resource-patterns.md) – Adding new SDK resources
