# Architecture: Adapters and Core

> **The boundary between `core/` and adapters is critical. Read this carefully.**

---

## Hard Rules

> [!CAUTION]
> These rules are **non-negotiable**.

### 1. `core/` Must Never Depend on Adapters

```typescript
// ❌ NEVER in core/
import { encodeFunctionData } from 'viem';
import { AbiCoder } from 'ethers';
import type { Address } from 'viem';
import type { Provider } from 'ethers';

// ✅ OK in core/
import type { Hex, Address } from './types/primitives';
import { ZKsyncError } from './errors';
```

### 2. Adapters Use Their Library's Encoders/Decoders

```typescript
// ❌ NEVER hand-roll encode/decode
const encoded = '0x' + functionSelector + param1.slice(2) + param2.slice(2);

// ✅ Viem adapter
import { encodeFunctionData, decodeFunctionResult } from 'viem';
const encoded = encodeFunctionData({ abi, functionName, args });

// ✅ Ethers adapter
import { Interface, AbiCoder } from 'ethers';
const iface = new Interface(abi);
const encoded = iface.encodeFunctionData(functionName, args);
```

### 3. Shared Logic Lives in `core/`

If logic is duplicated across adapters, extract it to `core/`:

```typescript
// core/utils/gas.ts
export function calculateL2GasLimit(baseCost: bigint, overhead: bigint): bigint {
  return baseCost + overhead;
}

// adapters/viem/resources/deposits.ts
import { calculateL2GasLimit } from '../../../core/utils/gas';

// adapters/ethers/resources/deposits.ts
import { calculateL2GasLimit } from '../../../core/utils/gas';
```

---

## Adapter Responsibilities

Adapters are **translation layers only**. They:

| Do | Don't |
|---|---|
| Translate core types to library types | Contain business logic |
| Call library methods (viem/ethers) | Duplicate logic across adapters |
| Map library results to core types | Define new types (types live in core/) |
| Handle library-specific errors | Hand-roll ABI encoding/decoding |

### Adapter Checklist

For any adapter code:
- [ ] Shared, adapter-agnostic logic extracted to `core/` (business logic requiring adapter imports is fine here)
- [ ] Uses library's native encoding/decoding
- [ ] Returns core types
- [ ] Accepts core types as input (or maps from them)
- [ ] Error handling wraps library errors into `ZKsyncError`

---

## Acceptable vs Unacceptable

### Imports in `core/`

```typescript
// ✅ Acceptable
import type { Hex, Address } from './types/primitives';
import { ZKsyncError } from './errors';
import { BRIDGEHUB_ABI } from './internal/abis';

// ❌ Unacceptable
import { type Address } from 'viem';
import { ethers } from 'ethers';
import { encodeFunctionData } from 'viem';
```

### Types in `core/`

```typescript
// ✅ Core defines primitives and flow types
// core/types/primitives.ts
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type Hash = `0x${string}`;

// core/types/flows/deposit.ts
export interface DepositRequest {
  token: Address;
  amount: bigint;
  to: Address;
}
```

### Adapter Implementation

```typescript
// ✅ Adapter translates and calls library
// adapters/viem/resources/deposits.ts
import { encodeFunctionData } from 'viem';
import type { DepositRequest } from '../../../core/types/flows/deposit';

export function prepareDeposit(ctx: ViemContext, req: DepositRequest) {
  const data = encodeFunctionData({
    abi: BRIDGEHUB_ABI,
    functionName: 'requestL2TransactionDirect',
    args: [req.to, req.amount, ...],
  });
  // ...
}
```

---

## When to Add to Core vs Adapter

| Scenario | Location |
|---|---|
| New type definition | `core/types/` |
| New constant (address, magic value) | `core/constants.ts` |
| Utility used by multiple adapters | `core/utils/` |
| ABI definition | `core/internal/abis/` |
| Library-specific call | Adapter |
| Library-specific error handling | Adapter (wrap to `ZKsyncError`) |
