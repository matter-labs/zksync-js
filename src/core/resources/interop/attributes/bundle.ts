// src/core/interop/attributes/bundle.ts
import type { Address, Hex } from '../../../types/primitives';
import type { AttributesCodec } from './types';

export function createBundleAttributes(codec: AttributesCodec) {
  const executionAddress = (executor: Address): Hex => codec.encode('executionAddress', [executor]);
  const unbundlerAddress = (addr: Address): Hex => codec.encode('unbundlerAddress', [addr]);
  const useFixedFee = (enabled: boolean): Hex => codec.encode('useFixedFee', [enabled]);

  const interopBundleSalt = (salt: Hex): Hex => codec.encode('interopBundleSalt', [salt]);

  return {
    executionAddress,
    unbundlerAddress,
    useFixedFee,
    interopBundleSalt,
  };
}
