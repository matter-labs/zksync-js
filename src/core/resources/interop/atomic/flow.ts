// src/core/resources/interop/atomic/flow.ts
//
// Atomic flows: the legs of one atomic transfer, bound to a deadline on the settlement layer.
//
// Every participant derives the same flow from the same legs: the contracts take the legs in
// strictly ascending order of their bundle hash, each with its source chain alongside, and hash the
// whole preimage into the flow id. The functions here do that canonicalization and the checks the
// AtomicFlowManager makes (`_validateAndComputeFlowId`), so a bad flow fails here rather than in a
// reverted send that has already burned the leg's funds.

import type { Address, Hex } from '../../../types/primitives';
import type { AtomicFlowPreimage, AtomicLeg } from '../../../types/flows/atomic-interop';
import { ATOMIC_FLOW_PREIMAGE_VERSION, MAX_ATOMIC_FLOW_LEGS } from '../../../constants';
import { OP_INTEROP } from '../../../types/errors';
import { createError } from '../../../errors/factory';
import { isHash66 } from '../../../utils/hash';
import { isAddress } from '../../../utils/addr';
import { keccak256Hex } from './hash';

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

function invalid(message: string, context: Record<string, unknown>): never {
  throw createError('VALIDATION', {
    resource: 'interop',
    operation: OP_INTEROP.atomic.flow,
    message,
    context,
  });
}

/** The legs of a flow in the order the contracts take them. */
export interface SortedAtomicLegs {
  /** Bundle hashes, strictly ascending. */
  legBundleHashes: Hex[];
  /** Each leg's source chain, aligned with `legBundleHashes`. */
  legSourceChainIds: bigint[];
  /** For each sorted position, the index of that leg in the input. */
  order: number[];
}

/**
 * Sorts legs into the order the contracts take them: ascending bundle hash, each hash keeping its
 * source chain. Sort the pairs with this, never the two arrays separately.
 *
 * @throws ZKsyncError (`VALIDATION`) when a bundle hash is not 32 bytes or appears twice.
 */
export function sortAtomicLegs(legs: readonly AtomicLeg[]): SortedAtomicLegs {
  legs.forEach((leg, index) => {
    if (!isHash66(leg.bundleHash)) {
      invalid('An atomic leg bundle hash must be 32 bytes of 0x-prefixed hex.', {
        index,
        bundleHash: leg.bundleHash,
      });
    }
    if (leg.sourceChainId < 0n || leg.sourceChainId > MAX_UINT256) {
      invalid('An atomic leg source chain id must fit in uint256.', {
        index,
        sourceChainId: leg.sourceChainId,
      });
    }
  });

  const indexed = legs
    .map((leg, index) => ({ hash: BigInt(leg.bundleHash), leg, index }))
    .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));

  for (let i = 1; i < indexed.length; i++) {
    if (indexed[i].hash === indexed[i - 1].hash) {
      invalid('An atomic flow cannot contain the same leg twice.', {
        bundleHash: indexed[i].leg.bundleHash,
      });
    }
  }

  return {
    legBundleHashes: indexed.map((x) => x.leg.bundleHash.toLowerCase() as Hex),
    legSourceChainIds: indexed.map((x) => x.leg.sourceChainId),
    order: indexed.map((x) => x.index),
  };
}

export interface BuildAtomicFlowPreimageInput {
  /** The settlement-layer timestamp by which every leg must be in a settled batch. */
  deadline: bigint;
  /** The settlement layer every leg settles on. */
  settlementLayerChainId: bigint;
  /** The legs, in any order. */
  legs: readonly AtomicLeg[];
}

/**
 * Builds the canonical preimage of the flow made of `legs`. Every participant that builds it from
 * the same legs, deadline and settlement layer gets the same preimage, whatever order the legs come
 * in.
 *
 * @throws ZKsyncError (`VALIDATION`) for an empty flow, more than `MAX_ATOMIC_FLOW_LEGS` legs, a
 * repeated leg, or a deadline that does not fit in `uint64`.
 */
export function buildAtomicFlowPreimage(input: BuildAtomicFlowPreimageInput): AtomicFlowPreimage {
  if (input.legs.length === 0) {
    invalid('An atomic flow needs at least one leg.', {});
  }
  const sorted = sortAtomicLegs(input.legs);
  const preimage: AtomicFlowPreimage = {
    version: ATOMIC_FLOW_PREIMAGE_VERSION,
    deadline: input.deadline,
    settlementLayerChainId: input.settlementLayerChainId,
    legBundleHashes: sorted.legBundleHashes,
    legSourceChainIds: sorted.legSourceChainIds,
  };
  validateAtomicFlowPreimage(preimage);
  return preimage;
}

/**
 * Checks `preimage` the way the AtomicFlowManager does before hashing it: the supported version,
 * at most `MAX_ATOMIC_FLOW_LEGS` legs, strictly ascending bundle hashes, one source chain per leg,
 * and a deadline that fits in `uint64`.
 *
 * @throws ZKsyncError (`VALIDATION`) naming the first rule the preimage breaks.
 */
export function validateAtomicFlowPreimage(preimage: AtomicFlowPreimage): void {
  if (preimage.version.toLowerCase() !== ATOMIC_FLOW_PREIMAGE_VERSION) {
    invalid('Unsupported atomic flow preimage version.', {
      expected: ATOMIC_FLOW_PREIMAGE_VERSION,
      actual: preimage.version,
    });
  }
  if (preimage.deadline < 0n || preimage.deadline > MAX_UINT64) {
    invalid('An atomic flow deadline must fit in uint64.', { deadline: preimage.deadline });
  }
  if (preimage.settlementLayerChainId < 0n || preimage.settlementLayerChainId > MAX_UINT256) {
    invalid('An atomic flow settlement layer chain id must fit in uint256.', {
      settlementLayerChainId: preimage.settlementLayerChainId,
    });
  }
  const n = preimage.legBundleHashes.length;
  if (n > MAX_ATOMIC_FLOW_LEGS) {
    invalid('An atomic flow has too many legs.', { maxLegs: MAX_ATOMIC_FLOW_LEGS, legs: n });
  }
  for (let i = 0; i < n; i++) {
    const hash = preimage.legBundleHashes[i];
    if (!isHash66(hash)) {
      invalid('An atomic leg bundle hash must be 32 bytes of 0x-prefixed hex.', {
        index: i,
        bundleHash: hash,
      });
    }
    if (i > 0 && BigInt(hash) <= BigInt(preimage.legBundleHashes[i - 1])) {
      invalid(
        'Atomic flow bundle hashes must be strictly ascending; build them with sortAtomicLegs.',
        {
          index: i,
        },
      );
    }
  }
  if (preimage.legSourceChainIds.length !== n) {
    invalid('An atomic flow needs exactly one source chain per leg.', {
      legs: n,
      chainIds: preimage.legSourceChainIds.length,
    });
  }
}

/**
 * The bundle hash of ABI-encoded `InteropBundle` bytes (`InteropDataEncoding.encodeInteropBundleHash`):
 * `keccak256(bundleData)`. Recompute it to bind bundle bytes received from someone else to the hash
 * that feeds the flow id.
 */
export function computeBundleHash(bundleData: Hex): Hex {
  return keccak256Hex(bundleData);
}

/**
 * The `interopBundleSalt` field of a bundle that `sender` sends with the `interopBundleSalt(salt)`
 * attribute: `keccak256(abi.encodePacked(sender, salt))`.
 */
export function computeInteropBundleSalt(sender: Address, salt: Hex): Hex {
  if (!isAddress(sender)) {
    throw createError('VALIDATION', {
      resource: 'interop',
      operation: OP_INTEROP.atomic.bundle,
      message: 'The bundle sender must be a 20-byte address.',
      context: { sender },
    });
  }
  if (!isHash66(salt)) {
    throw createError('VALIDATION', {
      resource: 'interop',
      operation: OP_INTEROP.atomic.bundle,
      message: 'The bundle salt must be 32 bytes of 0x-prefixed hex.',
      context: { salt },
    });
  }
  return keccak256Hex(`0x${sender.slice(2)}${salt.slice(2)}`);
}
