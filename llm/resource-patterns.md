# Resource Patterns

> **How to add a new SDK resource (e.g., `sdk.interop`).**

---

## Design Goals

- **Stripe-like, discoverable, stable** – `sdk.<resource>.<method>(...)`
- **Works across adapters consistently** – same API shape for viem and ethers
- **Core types & shapes in `core/`** – adapters only translate
- **Minimal adapter work** – call library, map results to core types

---

## Required Steps

### 1. Define Core Types

Create types in `core/types/flows/<resource>.ts`:

```typescript
// core/types/flows/interop.ts
export interface InteropRequest {
  token: Address;
  amount: bigint;
  to: Address;
}

export interface InteropResult {
  hash: Hash;
  status: 'pending' | 'confirmed' | 'finalized';
}

export interface InteropResource {
  quote(req: InteropRequest): Promise<InteropQuote>;
  prepare(req: InteropRequest): Promise<PreparedInterop>;
  create(req: InteropRequest): Promise<InteropHandle>;
  tryCreate(req: InteropRequest): Promise<Result<InteropHandle, ZKsyncError>>;
  wait(handle: InteropHandle, opts: WaitOpts): Promise<InteropResult>;
  tryWait(handle: InteropHandle, opts: WaitOpts): Promise<Result<InteropResult, ZKsyncError>>;
}
```

### 2. Define Core Constants (if needed)

Add to `core/constants.ts` or create `core/constants/<resource>.ts`:

```typescript
// core/constants.ts
export const GATEWAY_ADDRESS: Address = '0x...';
```

### 3. Define Core Resource Interface

Create in `core/resources/<resource>/`:

```typescript
// core/resources/interop/index.ts
export type { InteropResource } from '../../types/flows/interop';
```

### 4. Implement Adapter Bindings

Follow existing deposits/withdrawals structure:

```
src/adapters/viem/resources/interop/
├── index.ts           # createInteropResource(), exports, main implementation
├── context.ts         # Inner context/helpers (optional, see withdrawals/context.ts for example)
├── services/          # Service logic (optional, see withdrawals/services/finalization.ts for example)
└── routes/            # Route/flow logic (if applicable, see withdrawals/routes/ for example)

src/adapters/ethers/resources/interop/
├── index.ts
├── context.ts
├── services/
└── routes/
```

Each adapter implements the same `TransferResource` interface:

```typescript
// adapters/viem/resources/interop/index.ts
import type { InteropResource } from '../../../../core/types/flows/interop';

export function createInteropResource(client: ViemClient): InteropResource {
  return {
    quote: (req) => quoteInterop(client, req),
    prepare: (req) => prepareTransfer(client, req),
    create: (req) => createTransfer(client, req),
    tryCreate: (req) => tryCreateTransfer(client, req),
    wait: (handle, opts) => waitTransfer(client, handle, opts),
    tryWait: (handle, opts) => tryWaitTransfer(client, handle, opts),
  };
}
```

### 5. Wire onto SDK

Add to `sdk.ts` following existing pattern:

```typescript
// adapters/viem/sdk.ts
import { createInteropResource, type InteropResource } from './resources/interop/index';

export interface ViemSdk {
  deposits: DepositsResource;
  withdrawals: WithdrawalsResource;
  tokens: TokensResource;
  contracts: ContractsResource;
  interop: InteropResource; // New
}

export function createViemSdk(client: ViemClient): ViemSdk {
  return {
    deposits: createDepositsResource(client, tokens, contracts),
    withdrawals: createWithdrawalsResource(client, tokens, contracts),
    tokens: createTokensResource(client),
    contracts: createContractsResource(client),
    interop: createInteropResource(client), // New
  };
}
```

Do the same for `adapters/ethers/sdk.ts`.

### 6. Add Tests

- **Core unit tests**: `src/core/resources/<resource>/__tests__/`
- **Adapter unit tests**: `src/adapters/__tests__/` or within adapter directories
- Mock providers/clients for adapter tests

### 7. Update Docs

- Add to `docs/src/SUMMARY.md`
- Create SDK reference: `docs/src/sdk-reference/viem/<resource>.md` and `ethers/<resource>.md`
- Create quickstart guide: `docs/src/guides/<resource>.md` (follow deposits/withdrawals structure)
- Update LLM docs if applicable

---

## Method Naming Conventions

**Default interface for L1-L2, L2-L1, L2-L2 transactions:**

| Method       | Purpose                                  |
| ------------ | ---------------------------------------- |
| `quote`      | Get estimated costs/fees                 |
| `tryQuote`   | No-throw variant of `quote`              |
| `prepare`    | Prepare transaction data without sending |
| `tryPrepare` | No-throw variant of `prepare`            |
| `create`     | Execute the operation                    |
| `tryCreate`  | No-throw variant of `create`             |
| `status`     | Check current status                     |
| `wait`       | Wait for a specific state                |
| `tryWait`    | No-throw variant of `wait`               |
| `finalize`   | Complete a multi-step flow               |

**Helper resources** (like `tokens`, `contracts`) are exceptions – use appropriate method names for their purpose (e.g., `toL1Address`, `getBridgehubAddress`).

---

## Checklist

For a new resource:

- [ ] Core types defined in `core/types/flows/<resource>.ts`
- [ ] Core constants added (if needed)
- [ ] Viem adapter implements full interface
- [ ] Ethers adapter implements full interface
- [ ] Both adapters wired to SDK in `sdk.ts`
- [ ] Tests added (core + adapter)
- [ ] `SUMMARY.md` updated
- [ ] SDK reference docs added (viem + ethers)
- [ ] Quickstart guide added
- [ ] LLM docs updated (if applicable)
