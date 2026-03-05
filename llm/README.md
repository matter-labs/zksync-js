# LLM Guidance – zksync-js

> **Centralized documentation for AI assistants contributing to zksync-js.**

---

## Start Here

Read in this order:

1. [`repo-context.md`](./repo-context.md) – What this repo is, architecture overview
2. [`architecture-adapters-and-core.md`](./architecture-adapters-and-core.md) – Core vs adapter boundary (**critical**)
3. [`public-api-contract.md`](./public-api-contract.md) – Export surface and API gate
4. [`testing-and-quality.md`](./testing-and-quality.md) – Verification loops and quality checks
5. [`release-contract.md`](./release-contract.md) – Release and pre-1.0 policy
6. [`style-guide.md`](./style-guide.md) – Code style and naming

---

## Common Tasks

| Task | Guide |
|---|---|
| Add a new SDK resource | [`resource-patterns.md`](./resource-patterns.md) |
| Add a method to existing resource | [`resource-patterns.md`](./resource-patterns.md) + [`architecture-adapters-and-core.md`](./architecture-adapters-and-core.md) |
| Update types | [`architecture-adapters-and-core.md`](./architecture-adapters-and-core.md) (types live in `core/`) |
| Fix a bug | [`change-playbook.md`](./change-playbook.md) |
| Submit a PR | [`commit-and-pr.md`](./commit-and-pr.md) + [`public-api-contract.md`](./public-api-contract.md) |

## Codex Multi-Agent Roles

Canonical role behavior is defined in `.toml` files under [`.codex/agents`](../.codex/agents).

Human-readable role summaries:

- [`../agents/explorer.md`](../agents/explorer.md)
- [`../agents/planner.md`](../agents/planner.md)
- [`../agents/implementer.md`](../agents/implementer.md)
- [`../agents/reviewer.md`](../agents/reviewer.md)
- [`../agents/tester.md`](../agents/tester.md)
- [`../agents/docs.md`](../agents/docs.md)
- [`../agents/release.md`](../agents/release.md)
- [`../agents/api-sentinel.md`](../agents/api-sentinel.md)

---

## All Files

| File | Purpose |
|---|---|
| [`repo-context.md`](./repo-context.md) | Architecture overview, directory structure |
| [`architecture-adapters-and-core.md`](./architecture-adapters-and-core.md) | Core vs adapter boundary rules |
| [`public-api-contract.md`](./public-api-contract.md) | API surface, exports, compatibility contract, API gate |
| [`release-contract.md`](./release-contract.md) | Release process and pre-1.0 versioning policy |
| [`resource-patterns.md`](./resource-patterns.md) | Adding new SDK resources |
| [`style-guide.md`](./style-guide.md) | TypeScript code style |
| [`testing-and-quality.md`](./testing-and-quality.md) | Scripts, Definition of Done |
| [`change-playbook.md`](./change-playbook.md) | Standard change workflow |
| [`commit-and-pr.md`](./commit-and-pr.md) | Commit/PR conventions |
| [`security-and-secrets.md`](./security-and-secrets.md) | Security requirements |
| [`llm-behavior.md`](./llm-behavior.md) | How the assistant should respond |
| [`sdk-consumers.md`](./sdk-consumers.md) | **For agents using this SDK** (building UIs, bots) |
