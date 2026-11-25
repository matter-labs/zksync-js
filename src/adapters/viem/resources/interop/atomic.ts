// src/adapters/viem/resources/interop/atomic.ts
//
// Viem adapter for the atomic-interop helpers: supplies the ABI encoders the core helpers need.

import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import {
  createAtomicInteropHelpers,
  type AtomicInteropCodec,
  type AtomicInteropHelpers,
} from '../../../../core/resources/interop/atomic/helpers';
import {
  ATOMIC_FLOW_PREIMAGE_PARAM,
  INTEROP_BUNDLE_PARAM,
} from '../../../../core/internal/abis/AtomicInteropTypes';
import type { Hex } from '../../../../core/types/primitives';
import type { InteropBundle } from '../../../../core/types/flows/atomic-interop';

const COMMIT_LEAF_PARAMS = [{ type: 'bytes4' }, { type: 'bytes32' }, { type: 'bytes32' }] as const;

/** The atomic-interop ABI encoders, implemented with viem. */
export const viemAtomicInteropCodec: AtomicInteropCodec = {
  encodeFlowPreimage: (preimage) => encodeAbiParameters([ATOMIC_FLOW_PREIMAGE_PARAM], [preimage]),
  encodeCommitLeaf: (tag, flowId, bundleHash) =>
    encodeAbiParameters(COMMIT_LEAF_PARAMS, [tag, flowId, bundleHash]),
  encodeInteropBundle: (bundle) => encodeAbiParameters([INTEROP_BUNDLE_PARAM], [bundle]),
  decodeInteropBundle: (bundleData: Hex): InteropBundle => {
    const [bundle] = decodeAbiParameters([INTEROP_BUNDLE_PARAM], bundleData);
    return {
      ...bundle,
      calls: bundle.calls.map((call) => ({ ...call })),
      bundleAttributes: { ...bundle.bundleAttributes },
    };
  },
};

/**
 * Atomic-interop helpers (flow ids, commit values, finality proofs, bundle encoding) backed by viem.
 *
 * @example
 * const atomic = createViemAtomicInteropHelpers();
 * const flow = atomic.buildFlow({ deadline, settlementLayerChainId, legs });
 * const commitValue = atomic.computeCommitValue(flow.flowId, myLeg.bundleHash);
 */
export function createViemAtomicInteropHelpers(): AtomicInteropHelpers {
  return createAtomicInteropHelpers(viemAtomicInteropCodec);
}
