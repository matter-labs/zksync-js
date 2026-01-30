// src/core/interop/attributes/bundle.ts
import type { Address, Hex } from '../../../types/primitives';
import type { AttributesCodec } from './types';

export function createBundleAttributes(codec: AttributesCodec) {
  const executionAddress = (executor: Address): Hex => codec.encode('executionAddress', [executor]);

  const unbundlerAddress = (addr: Address): Hex => codec.encode('unbundlerAddress', [addr]);

  return {
    executionAddress,
    unbundlerAddress,
  };
}
