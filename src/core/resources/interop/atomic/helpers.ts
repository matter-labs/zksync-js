// src/core/resources/interop/atomic/helpers.ts
//
// Flow ids, commit values, finality proofs and bundle encoding. The ABI encoding is injected by the
// adapter (viem or ethers), so this stays adapter-agnostic.

import type { Hex } from '../../../types/primitives';
import type {
  AtomicFinalityProof,
  AtomicFlow,
  AtomicFlowPreimage,
  ImtProof,
  InteropBundle,
} from '../../../types/flows/atomic-interop';
import { ATOMIC_COMMIT_LEAF_TAG } from '../../../constants';
import { OP_INTEROP } from '../../../types/errors';
import { createError } from '../../../errors/factory';
import { isHash66, keccakHex } from '../../../utils/hash';
import {
  buildAtomicFlowPreimage,
  computeBundleHash,
  validateAtomicFlowPreimage,
  type BuildAtomicFlowPreimageInput,
} from './flow';

/** The ABI encoders the atomic helpers need, provided by an adapter. */
export interface AtomicInteropCodec {
  /** `abi.encode(AtomicFlowPreimage)`: the bytes the flow id hashes. */
  encodeFlowPreimage(preimage: AtomicFlowPreimage): Hex;
  /** `abi.encode(bytes4 tag, bytes32 flowId, bytes32 bundleHash)`: the bytes a commit value hashes. */
  encodeCommitLeaf(tag: Hex, flowId: Hex, bundleHash: Hex): Hex;
  /** `abi.encode(InteropBundle)`. */
  encodeInteropBundle(bundle: InteropBundle): Hex;
  /** The inverse of `encodeInteropBundle`. */
  decodeInteropBundle(bundleData: Hex): InteropBundle;
}

export function createAtomicInteropHelpers(codec: AtomicInteropCodec) {
  /**
   * `flowId = keccak256(abi.encode(preimage))`, after the checks the AtomicFlowManager makes.
   *
   * @throws ZKsyncError (`VALIDATION`) when the contracts would reject the preimage.
   */
  const computeFlowId = (preimage: AtomicFlowPreimage): Hex => {
    validateAtomicFlowPreimage(preimage);
    return keccakHex(codec.encodeFlowPreimage(preimage));
  };

  /** The flow made of `legs` (in any order), with its id. */
  const buildFlow = (input: BuildAtomicFlowPreimageInput): AtomicFlow => {
    const preimage = buildAtomicFlowPreimage(input);
    return { flowId: computeFlowId(preimage), preimage };
  };

  /**
   * Checks that `flow.flowId` is the hash of `flow.preimage`, which the contracts require
   * (`ManagerFlowIdMismatch`).
   */
  const assertFlow = (flow: AtomicFlow): void => {
    const computed = computeFlowId(flow.preimage);
    if (computed !== flow.flowId.toLowerCase()) {
      throw createError('VALIDATION', {
        resource: 'interop',
        operation: OP_INTEROP.atomic.flow,
        message: 'The flow id is not the hash of the flow preimage.',
        context: { flowId: flow.flowId, computed },
      });
    }
  };

  /**
   * The value that committing leg `bundleHash` of flow `flowId` inserts into its source chain's
   * commitment tree: `keccak256(abi.encode(ATOMIC_COMMIT_LEAF_TAG, flowId, bundleHash))`, as a
   * 32-byte word. Pass it to `zks_getImtInclusionProof`, `zks_getImtNonInclusionProof` and
   * `zks_getImtLowNullifierIndex`.
   */
  const computeCommitValue = (flowId: Hex, bundleHash: Hex): Hex => {
    for (const [field, value] of [
      ['flowId', flowId],
      ['bundleHash', bundleHash],
    ] as const) {
      if (!isHash66(value)) {
        throw createError('VALIDATION', {
          resource: 'interop',
          operation: OP_INTEROP.atomic.flow,
          message: `The ${field} must be 32 bytes of 0x-prefixed hex.`,
          context: { [field]: value },
        });
      }
    }
    return keccakHex(codec.encodeCommitLeaf(ATOMIC_COMMIT_LEAF_TAG, flowId, bundleHash));
  };

  /**
   * Where leg `bundleHash` is in the flow, which is how `authorizeRefund` names a missing leg.
   *
   * @throws ZKsyncError (`VALIDATION`) when the leg is not in the flow.
   */
  const legIndex = (flow: AtomicFlow, bundleHash: Hex): number => {
    const index = flow.preimage.legBundleHashes.findIndex(
      (hash) => hash.toLowerCase() === bundleHash.toLowerCase(),
    );
    if (index < 0) {
      throw createError('VALIDATION', {
        resource: 'interop',
        operation: OP_INTEROP.atomic.legIndex,
        message: 'The leg is not in the flow.',
        context: { flowId: flow.flowId, bundleHash },
      });
    }
    return index;
  };

  /**
   * The finality proof `executeAtomicBundle` takes: the flow, and one inclusion proof per leg in
   * the flow's leg order. `proofs` may come in any order; each is matched to its leg by the commit
   * value it proves and by its source chain.
   *
   * @throws ZKsyncError (`VALIDATION`) when the flow id does not match its preimage, or a leg has no
   * inclusion proof among `proofs`.
   */
  const buildFinalityProof = (
    flow: AtomicFlow,
    proofs: readonly ImtProof[],
  ): AtomicFinalityProof => {
    assertFlow(flow);
    const ordered = flow.preimage.legBundleHashes.map((bundleHash, i) => {
      const value = BigInt(computeCommitValue(flow.flowId, bundleHash));
      const sourceChainId = flow.preimage.legSourceChainIds[i];
      const proof = proofs.find(
        (p) =>
          !p.provesAgainstBeginRoot && p.leaf.value === value && p.sourceChainId === sourceChainId,
      );
      if (!proof) {
        throw createError('VALIDATION', {
          resource: 'interop',
          operation: OP_INTEROP.atomic.finality,
          message: 'A leg of the flow has no inclusion proof.',
          context: { flowId: flow.flowId, bundleHash, sourceChainId },
        });
      }
      return proof;
    });
    return { flow, proofs: ordered };
  };

  /** `abi.encode(bundle)`: the `bundleData` that `executeAtomicBundle` and `claimRefund` take. */
  const encodeInteropBundle = (bundle: InteropBundle): Hex => codec.encodeInteropBundle(bundle);

  /**
   * Decodes `bundleData` into an `InteropBundle`.
   *
   * @throws ZKsyncError (`VALIDATION`) when the bytes are not an ABI-encoded bundle.
   */
  const decodeInteropBundle = (bundleData: Hex): InteropBundle => {
    try {
      return codec.decodeInteropBundle(bundleData);
    } catch (e) {
      throw createError('VALIDATION', {
        resource: 'interop',
        operation: OP_INTEROP.atomic.bundle,
        message: 'The bytes are not an ABI-encoded InteropBundle.',
        context: { length: bundleData.length },
        cause: e,
      });
    }
  };

  /** The hash of `bundle`, which identifies it as a leg: `keccak256(abi.encode(bundle))`. */
  const bundleHashOf = (bundle: InteropBundle): Hex =>
    computeBundleHash(encodeInteropBundle(bundle));

  return {
    computeFlowId,
    buildFlow,
    assertFlow,
    computeCommitValue,
    legIndex,
    buildFinalityProof,
    encodeInteropBundle,
    decodeInteropBundle,
    bundleHashOf,
  };
}

export type AtomicInteropHelpers = ReturnType<typeof createAtomicInteropHelpers>;
