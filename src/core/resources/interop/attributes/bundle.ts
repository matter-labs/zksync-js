// src/core/interop/attributes/bundle.ts
import type { Address, Hex } from '../../../types/primitives';
import type { AtomicFlowPreimage } from '../../../types/flows/atomic-interop';
import type { AttributesCodec } from './types';

export function createBundleAttributes(codec: AttributesCodec) {
  const executionAddress = (executor: Address): Hex => codec.encode('executionAddress', [executor]);
  const unbundlerAddress = (addr: Address): Hex => codec.encode('unbundlerAddress', [addr]);
  const useFixedFee = (enabled: boolean): Hex => codec.encode('useFixedFee', [enabled]);

  const interopBundleSalt = (salt: Hex): Hex => codec.encode('interopBundleSalt', [salt]);

  // Atomic interop: marks the bundle as a leg of the flow `preimage` describes. It carries the
  // preimage, not the flow id: the contracts recompute the id and check that the bundle is one of
  // the legs. `lowNullifierIndex` is the commitment tree slot below the leg's commit value, which
  // `zks_getImtLowNullifierIndex` returns.
  const atomicBundle = (preimage: AtomicFlowPreimage, lowNullifierIndex: bigint): Hex =>
    codec.encode('atomicBundle', [
      {
        version: preimage.version,
        deadline: preimage.deadline,
        settlementLayerChainId: preimage.settlementLayerChainId,
        legBundleHashes: preimage.legBundleHashes,
        legSourceChainIds: preimage.legSourceChainIds,
      },
      lowNullifierIndex,
    ]);

  return {
    executionAddress,
    unbundlerAddress,
    useFixedFee,
    interopBundleSalt,
    atomicBundle,
  };
}
