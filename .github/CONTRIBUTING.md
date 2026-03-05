# 🤝 Contributing to zksync-js

Thanks for your interest in contributing! 🎉  
This project is open to bug fixes, features, documentation, and examples.

## 🛠 Getting Started

1. **Fork & clone** this repo

   ```bash
   git clone git@github.com:YOURNAME/zksync-js.git
   cd zksync-js
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Run tests** to verify everything works

   ```bash
   bun run test
   ```

## 📖 Contribution Types

- **Bug reports** – open a GitHub issue with clear steps to reproduce.
- **Fixes / features** – open a pull request. Keep changes focused.
- **Docs / examples** – improvements are always welcome!

## ✅ Pull Request Checklist

Before submitting a PR, please make sure:

- Commits are small and meaningful.
- `bun run test` passes locally.
- **Run code checks** to ensure style and types are correct:

  ```bash
  bun run lint
  bun run format:check
  bun run typecheck
  ```

- Update or add docs/examples if needed.
   For docs, make sure to import any code examples from tests inside `docs/snippets`.
   Use `ANCHOR` comments with unique tags to specify a code block within a test to import into a markdown file.
   For more information, check out the [mdbook docs](https://rust-lang.github.io/mdBook/format/mdbook.html#including-files).
- Link the related issue (if any).
- If your change touches export surface files, complete the **API Change Checklist** in the PR template (choose `No API change` or provide API impact details).

## 🤖 AI-Assisted Development

If you're using AI tools (Claude, ChatGPT, Cursor, etc.) to contribute:

- Start with [`AGENTS.md`](../AGENTS.md) for rules and workflow
- See [`llm/README.md`](../llm/README.md) for detailed guidance
- See [`docs/src/contributing/ai-codex.md`](../docs/src/contributing/ai-codex.md) for the contributor AI index and contracts

## 💬 Questions?

- Open a [GitHub Discussion](https://github.com/ZKsync-Community-Hub/zksync-developers/discussions/)
- Or join the [ZKsync community](https://x.com/zksync) for general questions.

Thanks again for helping improve `zksync-js`! 🚀
