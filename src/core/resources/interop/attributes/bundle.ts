// src/core/interop/attributes/bundle.ts
import type { Address, Hex } from '../../../types/primitives';
import type { AttributesCodec } from './types';

export function createBundleAttributes(codec: AttributesCodec) {
  const executionAddress = (executor: Address): Hex => codec.encode('executionAddress', [executor]);
  const unbundlerAddress = (addr: Address): Hex => codec.encode('unbundlerAddress', [addr]);
  const useFixedFee = (enabled: boolean): Hex => codec.encode('useFixedFee', [enabled]);

  /**
   * Protocol v32+ only. The InteropCenter stores `keccak256(sender, salt)` and rejects a repeat, so
   * the salt has to be fresh for every bundle a given sender sends.
   */
  const interopBundleSalt = (salt: Hex): Hex => codec.encode('interopBundleSalt', [salt]);

  return {
    executionAddress,
    unbundlerAddress,
    useFixedFee,
    interopBundleSalt,
  };
}
