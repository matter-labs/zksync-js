// src/adapters/ethers/resources/interop/atomic.ts
//
// Ethers adapter for the atomic-interop helpers: supplies the ABI encoders the core helpers need.

import { AbiCoder, ParamType, type Result } from 'ethers';
import {
  createAtomicInteropHelpers,
  type AtomicInteropCodec,
  type AtomicInteropHelpers,
} from '../../../../core/resources/interop/atomic/helpers';
import {
  ATOMIC_FLOW_PREIMAGE_PARAM,
  INTEROP_BUNDLE_PARAM,
} from '../../../../core/internal/abis/AtomicInteropTypes';
import type { Address, Hex } from '../../../../core/types/primitives';
import type { InteropBundle } from '../../../../core/types/flows/atomic-interop';

const coder = AbiCoder.defaultAbiCoder();
const FLOW_PREIMAGE = ParamType.from(ATOMIC_FLOW_PREIMAGE_PARAM);
const INTEROP_BUNDLE = ParamType.from(INTEROP_BUNDLE_PARAM);

function toInteropBundle(r: Result): InteropBundle {
  const attributes = r.bundleAttributes as Result;
  return {
    version: r.version as Hex,
    sourceChainId: r.sourceChainId as bigint,
    destinationChainId: r.destinationChainId as bigint,
    destinationBaseTokenAssetId: r.destinationBaseTokenAssetId as Hex,
    interopBundleSalt: r.interopBundleSalt as Hex,
    calls: (r.calls as Result).toArray().map((c: Result) => ({
      version: c.version as Hex,
      shadowAccount: c.shadowAccount as boolean,
      to: c.to as Address,
      from: c.from as Address,
      value: c.value as bigint,
      data: c.data as Hex,
    })),
    bundleAttributes: {
      executionAddress: attributes.executionAddress as Hex,
      unbundlerAddress: attributes.unbundlerAddress as Hex,
      useFixedFee: attributes.useFixedFee as boolean,
      salt: attributes.salt as Hex,
    },
  };
}

/** The atomic-interop ABI encoders, implemented with ethers. */
export const ethersAtomicInteropCodec: AtomicInteropCodec = {
  encodeFlowPreimage: (preimage) => coder.encode([FLOW_PREIMAGE], [preimage]) as Hex,
  encodeCommitLeaf: (tag, flowId, bundleHash) =>
    coder.encode(['bytes4', 'bytes32', 'bytes32'], [tag, flowId, bundleHash]) as Hex,
  encodeInteropBundle: (bundle) => coder.encode([INTEROP_BUNDLE], [bundle]) as Hex,
  decodeInteropBundle: (bundleData) =>
    toInteropBundle(coder.decode([INTEROP_BUNDLE], bundleData)[0] as Result),
};

/**
 * Atomic-interop helpers (flow ids, commit values, finality proofs, bundle encoding) backed by
 * ethers.
 *
 * @example
 * const atomic = createEthersAtomicInteropHelpers();
 * const flow = atomic.buildFlow({ deadline, settlementLayerChainId, legs });
 * const commitValue = atomic.computeCommitValue(flow.flowId, myLeg.bundleHash);
 */
export function createEthersAtomicInteropHelpers(): AtomicInteropHelpers {
  return createAtomicInteropHelpers(ethersAtomicInteropCodec);
}
