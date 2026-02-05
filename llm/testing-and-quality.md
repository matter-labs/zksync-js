# Testing and Quality

> **Scripts, quality checks, and Definition of Done.**

---

## Scripts

All commands are in `package.json`. Run with `bun run <script>`:

| Script         | Purpose                          |
| -------------- | -------------------------------- |
| `format`       | Auto-fix formatting (Prettier)   |
| `format:check` | Check formatting                 |
| `lint`         | Check lint (ESLint)              |
| `lint:fix`     | Auto-fix lint issues             |
| `test`         | Run unit and docs snippets tests |
| `test:cov`     | Run tests with coverage          |
| `test:core`    | Run core tests only              |
| `test:docs`    | Run docs snippets tests only     |
| `typecheck`    | Type check without emitting      |
| `build`        | Clean + build types + build JS   |
| `build:types`  | Build TypeScript declarations    |

> [!NOTE]
> E2E tests (`test:e2e:ethers`, `test:e2e:viem`) require a local zksyncos + L1 environment.

---

## Running Quality Checks

Before any commit or PR:

```bash
bun run lint
bun run format:check
bun run test
bun run typecheck
```

All must pass.

---

## Definition of Done

A change is complete when:

- [ ] `bun run lint` passes
- [ ] `bun run format:check` passes
- [ ] `bun run test` passes
- [ ] `bun run typecheck` passes
- [ ] Docs updated (if public-facing change)
- [ ] No secrets committed

---

## For AI Agents Using This SDK

If you're an AI agent building applications (e.g., UIs) that **use** this SDK:

### Installation

```bash
# For viem users
npm install @matterlabs/zksync-js viem

# For ethers users
npm install @matterlabs/zksync-js ethers
```

### Basic Usage

```typescript
// Viem
import { createViemClient, createViemSdk } from '@matterlabs/zksync-js/viem';

const client = createViemClient({ l1, l2, l1Wallet });
const sdk = createViemSdk(client);

// Use resources
const quote = await sdk.deposits.quote({ token, amount, to });
const handle = await sdk.deposits.create({ token, amount, to });
await sdk.deposits.wait(handle, { for: 'l2' });
```

### Try Methods

Use `try*` methods for no-throw error handling (recommended for UIs):

```typescript
const result = await sdk.deposits.tryCreate({ token, amount, to });
if (result.ok) {
  console.log('Success:', result.value);
} else {
  console.error('Error:', result.error);
}
```

### Available Resources

| Resource          | Methods                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `sdk.deposits`    | `quote`, `prepare`, `create`, `tryCreate`, `wait`, `tryWait`                       |
| `sdk.withdrawals` | `quote`, `prepare`, `create`, `tryCreate`, `status`, `wait`, `tryWait`, `finalize` |
| `sdk.tokens`      | `toL1Address`, `toL2Address`, `isBaseToken`, etc.                                  |
| `sdk.contracts`   | `getBridgehubAddress`, `getSharedBridgeAddress`, etc.                              |

### Documentation

- [User Book](https://matter-labs.github.io/zksync-js/latest/)
- [Quickstart](https://matter-labs.github.io/zksync-js/latest/quickstart/index.html)
- [Guides](https://matter-labs.github.io/zksync-js/latest/guides/index.html)
