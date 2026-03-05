# Release Contract

> Release-readiness rules for `zksync-js` contributors and automation agents.

## Release System

- Release PR + changelog flow is managed by release-please:
  - `.github/workflows/ci-release-please.yaml`
  - `.github/release-please/config.json`
  - `.github/release-please/manifest.json`
- Publish flow is managed by:
  - `.github/workflows/ci-release.yaml`
- npm publishing uses OIDC in CI (no static npm token expected in repo).

## Pre-1.0 Versioning Policy (Current Config)

Current release-please config includes:

- `bump-minor-pre-major: true`
- `bump-patch-for-minor-pre-major: true`

Interpretation for this repo while still `0.x`:

- Fix-level changes map to patch bumps.
- Feature additions map to minor pre-major bumps.
- Breaking API changes must be explicitly marked and called out in release notes.

Do not assume arbitrary version strategy outside this configuration.

## What Counts as Breaking

Treat these as breaking unless explicitly documented otherwise:

- Removing or renaming exported symbols
- Changing function/method signatures in exported API
- Changing behavior contracts relied on by existing public docs/examples
- Tightening accepted input shapes for exported types/functions

## Release-Please Etiquette

- Use conventional commit style for PR titles/messages (enforced by CI title check).
- Include API Change Checklist when API Gate paths are touched.
- Ensure changelog context is present for externally visible changes.
- Keep release PRs focused; avoid bundling unrelated refactors.

## Publish Checklist (No Secrets)

Before release/publish workflows:

- [ ] `bun run lint` passes
- [ ] `bun run format:check` passes
- [ ] `bun run test` passes
- [ ] `bun run typecheck` passes
- [ ] API Change Checklist present when required
- [ ] No secrets/tokens added to repo

Release role is validation-only and must not publish artifacts directly.
