# Release Role

Canonical behavior: [`.codex/agents/release.toml`](../.codex/agents/release.toml).

Purpose:

- Validate release readiness without publishing or mutating remote state.

Done definition:

- Provide semver impact classification, workflow readiness, and blockers.

Related docs:

- [`llm/release-contract.md`](../llm/release-contract.md)
- [`.github/workflows/ci-release-please.yaml`](../.github/workflows/ci-release-please.yaml)
