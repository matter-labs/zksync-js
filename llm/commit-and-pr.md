# Commit and PR

> **Commit conventions and PR checklist.**

---

## Commit Conventions

### Message Format

```
<type>: <short description>

[optional body]
```

### Types

| Type | Use for |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks |

### Examples

```
feat: add tryWait method to deposits resource
fix: handle undefined l2GasLimit in deposit quote
docs: update withdrawal finalization guide
refactor: extract shared gas calculation to core
test: add unit tests for token address mapping
```

### Guidelines

- Keep commits small and focused
- One logical change per commit
- Use imperative mood ("add", not "added" or "adds")

---

## PR Checklist

Before submitting:

- [ ] `bun run lint` passes
- [ ] `bun run format:check` passes
- [ ] `bun run test` passes
- [ ] `bun run typecheck` passes
- [ ] Commits are small and meaningful
- [ ] PR description explains the change
- [ ] Related issue linked (if applicable)
- [ ] Docs updated (if public-facing change)

---

## PR Description Template

```markdown
## Summary
Brief description of what this PR does.

## Changes
- Added X
- Fixed Y
- Updated Z

## Testing
How was this tested?

## Related Issues
Closes #123 (if applicable)
```
