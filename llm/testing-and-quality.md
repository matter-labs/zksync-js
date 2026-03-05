# Testing and Quality

> Verification loops for contributors and multi-agent workflows.

## Script Reference

Commands come from `package.json`:

| Command                   | Purpose                           |
| ------------------------- | --------------------------------- |
| `bun run lint`            | ESLint checks                     |
| `bun run format:check`    | Prettier validation               |
| `bun run format`          | Prettier write mode               |
| `bun run typecheck`       | TypeScript no-emit type checks    |
| `bun run test`            | Default repository test suite     |
| `bun run test:core`       | Core-only tests                   |
| `bun run test:docs`       | Docs snippet tests                |
| `bun run test:e2e:ethers` | Ethers adapter e2e tests          |
| `bun run test:e2e:viem`   | Viem adapter e2e tests            |
| `bun run build`           | Build declarations and JS bundles |
| `bun run docs:build`      | Build mdBook docs                 |

## Verification Loops

### Fast Loop (must run)

Run for every PR:

```bash
bun run lint
bun run format:check
bun run test
bun run typecheck
```

### Adapter E2E Loop (conditional)

Run the relevant adapter e2e suite(s) when changes touch adapter execution behavior, including:

- `src/adapters/ethers/**` for ethers flows
- `src/adapters/viem/**` for viem flows
- shared flow logic that can affect adapter transaction behavior

Commands:

```bash
bun run test:e2e:ethers
bun run test:e2e:viem
```

> E2E requires a local L1/L2 environment (zksyncos + test contracts).

### Docs Loop (conditional)

Run docs build when documentation or navigation changes are made:

- `docs/**`
- `AGENTS.md`
- `llm/**` (when docs contracts are updated and linked from docs)

Command:

```bash
bun run docs:build
```

## Definition of Done

- [ ] Fast loop passes
- [ ] Relevant adapter e2e loop(s) pass when adapter behavior changed
- [ ] Docs build passes when docs/navigation changed
- [ ] Public-facing changes include docs updates
- [ ] No secrets committed

## Related

- [`llm/change-playbook.md`](./change-playbook.md)
- [`llm/public-api-contract.md`](./public-api-contract.md)
