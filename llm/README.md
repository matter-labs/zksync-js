# LLM Guidance – zksync-js

> **Centralized documentation for AI assistants contributing to zksync-js.**

---

## Start Here

Read in this order:

1. [`repo-context.md`](./repo-context.md) – What this repo is, architecture overview
2. [`architecture-adapters-and-core.md`](./architecture-adapters-and-core.md) – Core vs adapter boundary (**critical**)
3. [`style-guide.md`](./style-guide.md) – Code style and naming
4. [`testing-and-quality.md`](./testing-and-quality.md) – Scripts and quality checks

---

## Common Tasks

| Task | Guide |
|---|---|
| Add a new SDK resource | [`resource-patterns.md`](./resource-patterns.md) |
| Add a method to existing resource | [`resource-patterns.md`](./resource-patterns.md) + [`architecture-adapters-and-core.md`](./architecture-adapters-and-core.md) |
| Update types | [`architecture-adapters-and-core.md`](./architecture-adapters-and-core.md) (types live in `core/`) |
| Fix a bug | [`change-playbook.md`](./change-playbook.md) |
| Submit a PR | [`commit-and-pr.md`](./commit-and-pr.md) |

---

## All Files

| File | Purpose |
|---|---|
| [`repo-context.md`](./repo-context.md) | Architecture overview, directory structure |
| [`architecture-adapters-and-core.md`](./architecture-adapters-and-core.md) | Core vs adapter boundary rules |
| [`resource-patterns.md`](./resource-patterns.md) | Adding new SDK resources |
| [`style-guide.md`](./style-guide.md) | TypeScript code style |
| [`testing-and-quality.md`](./testing-and-quality.md) | Scripts, Definition of Done |
| [`change-playbook.md`](./change-playbook.md) | Standard change workflow |
| [`commit-and-pr.md`](./commit-and-pr.md) | Commit/PR conventions |
| [`security-and-secrets.md`](./security-and-secrets.md) | Security requirements |
| [`llm-behavior.md`](./llm-behavior.md) | How the assistant should respond |
