# Repo Context

> **What this repo is and how it's organized.**

---

## Overview

**zksync-js** is the official TypeScript SDK for ZKsync OS (Elastic Network).

**Features:**

- Deposits (L1 → L2) – ETH and ERC-20
- Withdrawals (L2 → L1) – full two-step flows with status tracking + finalization
- `zks_` RPC methods – typed helpers
- Token address mapping, contract address fetching
- Try-methods (`tryCreate`, `tryWait`) – no-throw style for UI/services

**Adapters:**

- `viem` adapter – for viem users
- `ethers` adapter – for ethers v6 users

## Repo Shape and Tooling

- Single-package repository (no workspace manager files).
- Package manager: Bun (`bun install`).
- Build: TypeScript declarations (`tsc`) + JS bundles (`tsup`).
- Lint/format: ESLint + Prettier.
- Tests: Bun test, with adapter-specific e2e commands.
- Docs: mdBook (`docs/src` -> `docs/book`).

---

## Architecture

```
src/
├── core/                    # Adapter-agnostic (NO viem/ethers imports)
│   ├── types/               # Shared types, primitives, errors
│   ├── resources/           # Core resource interfaces
│   ├── internal/            # ABIs, internal utilities
│   ├── constants.ts         # Addresses, magic values
│   ├── errors/              # Error types
│   └── utils/               # Shared utilities
│
├── adapters/
│   ├── ethers/              # Ethers v6 adapter
│   │   ├── sdk.ts           # createEthersSdk()
│   │   ├── client.ts        # createEthersClient()
│   │   └── resources/       # Resource implementations
│   │       ├── deposits/
│   │       ├── withdrawals/
│   │       ├── interop/
│   │       ├── tokens/
│   │       └── contracts/
│   │
│   └── viem/                # Viem adapter
│       ├── sdk.ts           # createViemSdk()
│       ├── client.ts        # createViemClient()
│       └── resources/       # Resource implementations
│           ├── deposits/
│           ├── withdrawals/
│           ├── tokens/
│           └── contracts/
│
└── index.ts                 # Package entry point
```

---

## Public API Surface

Public API is controlled by:

- `package.json` -> `exports` and `typesVersions`
- `src/index.ts`
- `src/core/index.ts`
- `src/adapters/ethers/index.ts`
- `src/adapters/viem/index.ts`

Export paths include:

- `@matterlabs/zksync-js`
- `@matterlabs/zksync-js/core`
- `@matterlabs/zksync-js/types`
- `@matterlabs/zksync-js/ethers` (+ adapter subpaths)
- `@matterlabs/zksync-js/viem` (+ adapter subpaths)

See [`public-api-contract.md`](./public-api-contract.md) for API gate requirements.

## Resource Directory Structure

Each resource follows a consistent pattern:

```
resources/<resource>/
├── index.ts                 # Public exports, createXResource(), Main implementation
├── context.ts               # Internal context/helpers (optional)
├── routes/                  # Route/flow logic (optional, see withdrawals/routes/ for example)
├── services/                # Service logic (optional, see withdrawals/services/finalization.ts for example)
└── ...                      # Additional modules as needed
```

---

## Key Directories

| Directory                        | Purpose                                       |
| -------------------------------- | --------------------------------------------- |
| `src/core/`                      | Adapter-agnostic types, constants, utilities  |
| `src/core/types/`                | Shared types (primitives, errors, flow types) |
| `src/core/resources/`            | Core resource interfaces                      |
| `src/adapters/ethers/`           | Ethers v6 adapter implementation              |
| `src/adapters/viem/`             | Viem adapter implementation                   |
| `docs/`                          | User documentation (mdbook)                   |
| `docs/src/`                      | Documentation source files                    |
| `examples/`                      | Usage examples for both adapters              |
| `tests/`                         | Test files                                    |
| `typechain/`                     | Generated contract types                      |
| `src/adapters/ethers/typechain/` | Generated adapter-local typechain bindings    |

## Generated Boundaries

- Never edit generated files directly: `src/adapters/ethers/typechain/**` and `typechain/**`.
- Regenerate using: `bun run types`.
- If regeneration changes outputs, include generated diffs in the same PR.

---

## SDK Pattern

```typescript
// Ethers
const client = await createEthersClient({ l1Provider, l2Provider, signer });
const sdk = createEthersSdk(client);

// Viem
const client = createViemClient({ l1, l2, l1Wallet });
const sdk = createViemSdk(client);

// Usage (mostly same API shape for both)
sdk.deposits.quote({ ... });
sdk.deposits.create({ ... });
sdk.withdrawals.wait(handle, { for: 'finalized' });
sdk.tokens.toL2Address(address);
sdk.contracts.getBridgehubAddress();
```

> Note: interop resources are currently implemented in ethers adapter.

---

## CI and Release

- CI checks: lint, format, typecheck, build, tests, coverage, docs snippets.
- Release automation: release-please + separate publish workflow with npm OIDC.
- PR titles must follow conventional commit style (enforced by CI).
