# Public API Contract

> Canonical rules for preserving SDK API stability and preventing accidental export drift.

## Canonical API Sources

Treat these as API source of truth:

- `package.json` (`exports` or `typesVersions`)
- `src/index.ts`
- `src/core/index.ts`
- `src/adapters/ethers/index.ts`
- `src/adapters/viem/index.ts`
- `src/core/types/**`
- any newly exported type from those entrypoints

Any change to the paths above is an API-surface change candidate.

## API Gate (Required)

If any API-source path changes, the PR description must include an API Change Checklist entry.

Minimum checklist content:

- [ ] `No API change` **or**
- [ ] `API change` with:
  - changed entrypoint/export path(s)
  - compatibility impact (non-breaking or breaking)
  - docs updates
  - changelog/release notes context

Use this gate even for refactors that are believed to be internal-only.

## Semver and Deprecation

- Follow conventional commit style for release automation compatibility.
- Do not remove or rename public symbols silently.
- Deprecations must use `@deprecated` with a replacement path and removal intent.
- Breaking API changes must be called out explicitly in PR/release notes.

## Compatibility Contract (Current Repo Truth)

| Area                  | Current contract                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Bun                   | Primary contributor/runtime toolchain; CI uses Bun `1.3.5` for build/test checks.                          |
| Node                  | No `engines` field is declared. CI currently uses Node `20` (license check) and `22.x` (publish workflow). |
| TypeScript            | SDK source currently depends on TypeScript `^5.5.0`; keep public types compatible with this baseline.      |
| Ethers adapter        | Peer dependency: `ethers ^6.15.0` (optional peer).                                                         |
| Viem adapter          | Peer dependency: `viem >=2.0.0 <3` (optional peer).                                                        |
| Ethers typechain peer | Peer dependency: `@typechain/ethers-v6 ^0.5.0` (optional peer).                                            |

## Generated File Protocol

- Never edit generated files directly: `src/adapters/ethers/typechain/**` and `typechain/**`.
- Regenerate using: `bun run types`.
- If regeneration changes outputs, include generated diffs in the same PR.

## Export Change Checklist (Quick)

Before merge on API-source changes:

- [ ] Entry-point exports reviewed for accidental removals/renames
- [ ] Type-only exports still resolve correctly
- [ ] Docs updated when public behavior changed
- [ ] PR includes API Change Checklist declaration
