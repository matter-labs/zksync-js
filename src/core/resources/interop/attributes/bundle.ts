// src/core/interop/attributes/bundle.ts
import type { Hex } from '../../../types/primitives';
import type { AttributesCodec } from './types';

export function createBundleAttributes(codec: AttributesCodec) {
  const executionAddress = (executor: Hex): Hex => codec.encode('executionAddress', [executor]);
  const useFixedFee = (enabled: boolean): Hex => codec.encode('useFixedFee', [enabled]);
  const interopBundleSalt = (salt: Hex): Hex => codec.encode('interopBundleSalt', [salt]);
  const atomicBundle = (flowId: Hex, deadline: bigint, lowNullifierIndex: bigint): Hex =>
    codec.encode('atomicBundle', [flowId, deadline, lowNullifierIndex]);

  return {
    atomicBundle,
    executionAddress,
    useFixedFee,
    interopBundleSalt,
  };
}
