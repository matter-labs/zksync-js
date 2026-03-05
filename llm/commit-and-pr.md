# Commit and PR

> Commit, PR, and API checklist requirements for this SDK.

## Commit and Title Conventions

- Keep commit messages and PR titles compatible with Conventional Commits.
- PR title lint is enforced in CI (`ci-title-check.yaml`).
- Use small, focused commits with one logical change per commit.

Common types:

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `chore`

## Required PR Checklist

Before submitting:

- [ ] `bun run lint` passes
- [ ] `bun run format:check` passes
- [ ] `bun run test` passes
- [ ] `bun run typecheck` passes
- [ ] `bun run docs:build` passes when docs/navigation changed
- [ ] PR description explains scope and verification
- [ ] Docs updated when public behavior changed

## API Change Checklist (Required When API Gate Triggers)

API Gate paths are defined in [`llm/public-api-contract.md`](./public-api-contract.md).

When triggered, PR description must include:

- [ ] `No API change` **or**
- [ ] `API change` with:
  - entrypoints/exports changed
  - compatibility impact (non-breaking or breaking)
  - docs/changelog context

## Release-Please Friendly Practices

- Use clear conventional change intent (`feat`, `fix`, etc.).
- Mark breaking changes explicitly in commit body/footer when applicable.
- Keep release-relevant context in PR description to improve changelog quality.
