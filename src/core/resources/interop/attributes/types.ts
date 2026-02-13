// src/core/interop/attributes/types.ts
import type { Hex } from '../../../types/primitives';

// Codec interface for encoding interop message attributes.
// Abstracts the ABI encoding logic, allowing the core resource to remain
// adapter agnostic. Adapters (e.g. viem) provide the actual implementation.
export interface AttributesCodec {
  encode(fn: string, args: readonly unknown[]): Hex;
}
