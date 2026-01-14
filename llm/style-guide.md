# Style Guide

> **TypeScript code style and naming conventions for zksync-js.**

---

## Formatting

This repo uses **Prettier** and **ESLint**. Run before committing:

```bash
bun run format        # Auto-fix formatting
bun run format:check  # Check formatting
bun run lint          # Check lint
bun run lint:fix      # Auto-fix lint
```

---

## TypeScript Conventions

### General

- Use `type` for type aliases, `interface` for object shapes
- Prefer explicit return types on exported functions
- Use `bigint` for all numeric values that may exceed `Number.MAX_SAFE_INTEGER`
- Use strict null checks (`strictNullChecks: true`)

### Naming

| Type             | Convention              | Example                                |
| ---------------- | ----------------------- | -------------------------------------- |
| Files            | kebab-case              | `deposit-context.ts`                   |
| Types/Interfaces | PascalCase              | `DepositRequest`, `TransferResult`     |
| Functions        | camelCase               | `createDeposit`, `waitForFinalization` |
| Constants        | UPPER_SNAKE_CASE        | `ETH_ADDRESS`, `BRIDGEHUB_ABI`         |
| Type parameters  | Single uppercase letter | `T`, `R`, `E`                          |

### Imports

- Group imports: external libs → core imports → local imports
- Use `type` keyword for type-only imports

```typescript
// External
import { encodeFunctionData } from 'viem';

// Core
import type { Address, Hash } from '../../../core/types/primitives';
import { ZKsyncError } from '../../../core/errors';

// Local
import { prepareContext } from './context';
```

### Exports

- Use named exports (no default exports)
- Export types from barrel files (`index.ts`)

```typescript
// ✅ Named export
export function createDeposit() { ... }
export type { DepositRequest };

// ❌ Avoid default exports
export default function createDeposit() { ... }
```

---

## Error Handling

- Use the repo's `ZKsyncError` class for errors
- Wrap library errors (viem/ethers) into `ZKsyncError`
- Use `try*` variants for no-throw public methods
- Review existing error handling patterns for consistency in deposits/withdrawals

```typescript
// Throwing method
async function create(req: DepositRequest): Promise<DepositHandle> {
  try {
    // ...
  } catch (error) {
    throw new ZKsyncError('DEPOSIT_FAILED', 'Failed to create deposit', { cause: error });
  }
}

// No-throw method
async function tryCreate(req: DepositRequest): Promise<Result<DepositHandle, ZKsyncError>> {
  try {
    const result = await create(req);
    return { ok: true, value: result };
  } catch (error) {
    return { ok: false, error: error as ZKsyncError };
  }
}
```

---

## Comments

- Use JSDoc for exported functions and types
- Keep comments very concise
- Don't state the obvious

```typescript
/**
 * Creates a deposit transaction from L1 to L2.
 * @param req - Deposit request parameters
 * @returns Handle for tracking the deposit
 */
export async function createDeposit(req: DepositRequest): Promise<DepositHandle> {
  // ...
}
```

---

## Testing

- Test files: `*.test.ts` or in `__tests__/` directories
- Use descriptive test names
- Mock external dependencies

```typescript
describe('createDeposit', () => {
  it('should return a valid deposit handle for ETH deposits', async () => {
    // Arrange
    const req = { token: ETH_ADDRESS, amount: 1000n, to: '0x...' };

    // Act
    const handle = await createDeposit(req);

    // Assert
    expect(handle.hash).toBeDefined();
  });
});
```
