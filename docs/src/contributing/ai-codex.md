# Contributor AI / Codex Guide

This page links to contributor and agent contracts used to keep SDK changes safe and reviewable.

## Start Here

- [AGENTS.md](../../../AGENTS.md) - repository-wide contributor rules
- [LLM guidance index](../../../llm/README.md) - architecture, testing, release, and API contracts

## Key Contracts

- [Public API Contract](../../../llm/public-api-contract.md)
- [Release Contract](../../../llm/release-contract.md)
- [Testing and Quality](../../../llm/testing-and-quality.md)
- [Change Playbook](../../../llm/change-playbook.md)

## Multi-Agent Roles

- Canonical role configs: [`.codex/agents`](../../../.codex/agents)
- Human-readable role summaries: [`agents/`](../../../agents)

## Notes

- Core/adapters boundary is mandatory: `src/core` stays adapter-agnostic.
- API Gate applies to exports and entrypoint/type-surface changes.
- Generated files must be regenerated, not manually edited.
