# AGENTS.md – SDK Multi-Agent Guide

`zksync-js` is a TypeScript SDK for ZKsync cross-chain flows and helpers: deposits, withdrawals/finalization, typed `zks_` RPC methods, token mapping, and contract helpers. The repository is intentionally split into adapter-agnostic `src/core` and adapter translation layers in `src/adapters/{ethers,viem}`.

For detailed guidance, start at [`llm/README.md`](./llm/README.md).

## Golden Commands

Use these exact commands:

- Install: `bun install`
- Build: `bun run build`
- Test: `bun run test`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Format check: `bun run format:check`
- Format write: `bun run format`
- Docs build (optional): `bun run docs:build`
- Docs serve (optional): `bun run docs:serve`
- Adapter e2e (when relevant): `bun run test:e2e:ethers`, `bun run test:e2e:viem`

## Hard Boundaries

1. Preserve architecture:

- `src/core` must stay adapter-agnostic.
- Do not import `ethers` or `viem` types/functions into `src/core`.
- Adapters translate core abstractions into library calls.

2. API Gate is mandatory for export-surface changes:

- Trigger files:
  - `package.json` (`exports` or `typesVersions`)
  - `src/index.ts`
  - `src/core/index.ts`
  - `src/adapters/ethers/index.ts`
  - `src/adapters/viem/index.ts`
  - `src/core/types/**`
  - Any newly exported type from those entrypoints
- If triggered, PR description must include an API Change Checklist entry, including explicit `No API change` when applicable.

3. Generated file protocol:

- Never edit generated files directly: `src/adapters/ethers/typechain/**` and `typechain/**`.
- Regenerate using: `bun run types`.
- If regeneration changes outputs, include generated diffs in the same PR.

4. Security and safety:

- Never commit secrets, private keys, tokens, or internal endpoints.
- Default to no network calls (no live RPC hits) during local validation.
- Network exceptions: only when explicitly requested by maintainers or when required for approved e2e execution.

5. Change management:

- Ask before large refactors or dependency upgrades.
- Keep diffs minimal and scoped; avoid unrelated cleanup.
- Do not change public exports without updating docs and changelog context.

## Navigation

- Main public API:
  - [`src/index.ts`](./src/index.ts)
  - [`src/core/index.ts`](./src/core/index.ts)
  - [`src/adapters/ethers/index.ts`](./src/adapters/ethers/index.ts)
  - [`src/adapters/viem/index.ts`](./src/adapters/viem/index.ts)
- Core vs adapters:
  - [`src/core`](./src/core)
  - [`src/adapters`](./src/adapters)
- Examples:
  - [`examples/README.md`](./examples/README.md)
- User docs:
  - [`docs/src`](./docs/src)
- Agent/contributor contracts:
  - [`llm/public-api-contract.md`](./llm/public-api-contract.md)
  - [`llm/release-contract.md`](./llm/release-contract.md)
  - [`llm/testing-and-quality.md`](./llm/testing-and-quality.md)

## Skills

- Skills are optional and should be invoked when relevant.
- Use [`$contract-interaction-patterns`](./.agents/skills/contract-interaction-patterns/SKILL.md) for ABI edits, contract wrapper/client changes, calldata construction, and event/log decoding updates.
- Do not invoke it for unrelated utility edits, docs-only formatting, or CI-only changes.
- Skill index: [`.agents/skills/README.md`](./.agents/skills/README.md)

## Workflow

1. Restate objective and constraints.
2. Identify files to touch.
3. Implement with minimal diff.
4. Run verification commands.
5. Update docs/contracts when public behavior or API surface changes.

## Definition of Done

- [ ] `bun run lint` passes
- [ ] `bun run format:check` passes
- [ ] `bun run test` passes
- [ ] `bun run typecheck` passes
- [ ] `bun run docs:build` passes when docs were touched
- [ ] API checklist included when API Gate is triggered
- [ ] No secrets committed
