import { describe, it, expect } from 'bun:test';
import { AbiCoder, ParamType } from 'ethers';

import {
  buildAtomicFlowPreimage,
  computeBundleHash,
  computeInteropBundleSalt,
  sortAtomicLegs,
  validateAtomicFlowPreimage,
} from '../flow';
import { createAtomicInteropHelpers, type AtomicInteropCodec } from '../helpers';
import {
  ATOMIC_FLOW_PREIMAGE_PARAM,
  INTEROP_BUNDLE_PARAM,
} from '../../../../internal/abis/AtomicInteropTypes';
import { ATOMIC_COMMIT_LEAF_TAG, MAX_ATOMIC_FLOW_LEGS } from '../../../../constants';
import { isZKsyncError } from '../../../../types/errors';
import type { Hex } from '../../../../types/primitives';
import type { ImtProof } from '../../../../types/flows/atomic-interop';
import { BUNDLE_DATA, BUNDLE_HASH, BUNDLE_SALT, COMMIT_TAG, FLOW, SALT, SENDER } from './vectors';

// A minimal ethers codec, so these tests exercise real ABI encodings without an adapter.
const coder = AbiCoder.defaultAbiCoder();
const codec: AtomicInteropCodec = {
  encodeFlowPreimage: (p) => coder.encode([ParamType.from(ATOMIC_FLOW_PREIMAGE_PARAM)], [p]) as Hex,
  encodeCommitLeaf: (tag, flowId, bundleHash) =>
    coder.encode(['bytes4', 'bytes32', 'bytes32'], [tag, flowId, bundleHash]) as Hex,
  encodeInteropBundle: (b) => coder.encode([ParamType.from(INTEROP_BUNDLE_PARAM)], [b]) as Hex,
  decodeInteropBundle: () => {
    throw new Error('not used');
  },
};
const atomic = createAtomicInteropHelpers(codec);

const hash = (byte: string) => `0x${byte.repeat(32)}` as Hex;

function expectValidationError(fn: () => unknown, messageIncludes: string) {
  try {
    fn();
  } catch (e) {
    expect(isZKsyncError(e, { type: 'VALIDATION', messageIncludes })).toBe(true);
    return;
  }
  throw new Error('expected a validation error');
}

describe('interop/atomic constants', () => {
  it('derives the commit leaf tag from its domain string', () => {
    expect(ATOMIC_COMMIT_LEAF_TAG).toBe(COMMIT_TAG);
  });
});

describe('interop/atomic.sortAtomicLegs', () => {
  it('sorts by bundle hash, keeping each chain with its hash and mapping back to the input', () => {
    expect(sortAtomicLegs(FLOW.legs)).toEqual({
      legBundleHashes: [FLOW.legs[1].bundleHash, FLOW.legs[0].bundleHash],
      legSourceChainIds: [6566n, 6565n],
      order: [1, 0],
    });
  });

  it('compares hashes as numbers, not as mixed-case strings', () => {
    const sorted = sortAtomicLegs([
      { bundleHash: `0x${'A'.repeat(64)}`, sourceChainId: 1n },
      { bundleHash: `0x${'9'.repeat(64)}`, sourceChainId: 2n },
    ]);
    expect(sorted.legSourceChainIds).toEqual([2n, 1n]);
    expect(sorted.legBundleHashes[1]).toBe(`0x${'a'.repeat(64)}`);
  });

  it('rejects a leg that appears twice, whatever its case', () => {
    expectValidationError(
      () =>
        sortAtomicLegs([
          { bundleHash: `0x${'ab'.repeat(32)}`, sourceChainId: 1n },
          { bundleHash: `0x${'AB'.repeat(32)}`, sourceChainId: 2n },
        ]),
      'same leg twice',
    );
  });

  it('rejects a bundle hash that is not 32 bytes', () => {
    expectValidationError(
      () => sortAtomicLegs([{ bundleHash: '0x1234', sourceChainId: 1n }]),
      '32 bytes',
    );
  });
});

describe('interop/atomic.buildAtomicFlowPreimage', () => {
  it('builds the same preimage whatever order the legs come in', () => {
    const one = buildAtomicFlowPreimage(FLOW);
    const other = buildAtomicFlowPreimage({ ...FLOW, legs: [...FLOW.legs].reverse() });
    expect(one).toEqual(other);
    expect(one.version).toBe('0x01');
  });

  it('rejects an empty flow, too many legs and a deadline beyond uint64', () => {
    expectValidationError(() => buildAtomicFlowPreimage({ ...FLOW, legs: [] }), 'at least one');
    const many = Array.from({ length: MAX_ATOMIC_FLOW_LEGS + 1 }, (_, i) => ({
      bundleHash: hash((i + 16).toString(16)),
      sourceChainId: 1n,
    }));
    expectValidationError(() => buildAtomicFlowPreimage({ ...FLOW, legs: many }), 'too many');
    expectValidationError(
      () => buildAtomicFlowPreimage({ ...FLOW, deadline: 1n << 64n }),
      'uint64',
    );
  });
});

describe('interop/atomic.validateAtomicFlowPreimage', () => {
  const preimage = buildAtomicFlowPreimage(FLOW);

  it('accepts a canonical preimage', () => {
    expect(() => validateAtomicFlowPreimage(preimage)).not.toThrow();
  });

  it('rejects what the AtomicFlowManager rejects', () => {
    expectValidationError(
      () => validateAtomicFlowPreimage({ ...preimage, version: '0x02' }),
      'version',
    );
    expectValidationError(
      () =>
        validateAtomicFlowPreimage({
          ...preimage,
          legBundleHashes: [...preimage.legBundleHashes].reverse(),
        }),
      'ascending',
    );
    expectValidationError(
      () => validateAtomicFlowPreimage({ ...preimage, legSourceChainIds: [1n] }),
      'one source chain per leg',
    );
  });
});

describe('interop/atomic flow ids and commit values', () => {
  it('derives the flow id the chain accepted', () => {
    expect(atomic.buildFlow(FLOW).flowId).toBe(FLOW.flowId);
    expect(atomic.buildFlow({ ...FLOW, legs: [...FLOW.legs].reverse() }).flowId).toBe(FLOW.flowId);
  });

  it('computes each leg commit value as the contracts do', () => {
    FLOW.legs.forEach((leg, i) => {
      expect(atomic.computeCommitValue(FLOW.flowId, leg.bundleHash)).toBe(FLOW.commitValues[i]);
    });
  });

  it('refuses a flow whose id is not the hash of its preimage', () => {
    const flow = atomic.buildFlow(FLOW);
    expectValidationError(() => atomic.assertFlow({ ...flow, flowId: hash('00') }), 'not the hash');
  });

  it('finds a leg by its hash', () => {
    const flow = atomic.buildFlow(FLOW);
    expect(atomic.legIndex(flow, FLOW.legs[0].bundleHash)).toBe(1);
    expect(atomic.legIndex(flow, FLOW.legs[1].bundleHash.toUpperCase() as Hex)).toBe(0);
    expectValidationError(() => atomic.legIndex(flow, hash('77')), 'not in the flow');
  });
});

describe('interop/atomic.buildFinalityProof', () => {
  const flow = atomic.buildFlow(FLOW);
  const proofFor = (legInInput: number, overrides: Partial<ImtProof> = {}): ImtProof => ({
    sourceChainId: FLOW.legs[legInInput].sourceChainId,
    batchNumber: 10n + BigInt(legInInput),
    chainImtRoot: hash('aa'),
    provesAgainstBeginRoot: false,
    settlementProof: [hash('bb')],
    leaf: { value: BigInt(FLOW.commitValues[legInInput]), nextIndex: 0n, nextValue: 0n },
    imtLeafIndex: 3n,
    imtProof: [],
    ...overrides,
  });

  it('orders the proofs by the flow legs, whatever order they come in', () => {
    const finality = atomic.buildFinalityProof(flow, [proofFor(0), proofFor(1)]);
    expect(finality.flow).toEqual(flow);
    // The flow's first leg is input leg 1 (its hash is the smaller one).
    expect(finality.proofs.map((p) => p.batchNumber)).toEqual([11n, 10n]);
  });

  it('refuses when a leg has no inclusion proof', () => {
    expectValidationError(() => atomic.buildFinalityProof(flow, [proofFor(0)]), 'no inclusion');
    // An absence proof of the same value, or one from another chain, is not an inclusion proof.
    expectValidationError(
      () =>
        atomic.buildFinalityProof(flow, [
          proofFor(0),
          proofFor(1, { provesAgainstBeginRoot: true }),
        ]),
      'no inclusion',
    );
    expectValidationError(
      () => atomic.buildFinalityProof(flow, [proofFor(0), proofFor(1, { sourceChainId: 1n })]),
      'no inclusion',
    );
  });
});

describe('interop/atomic bundles', () => {
  it('hashes bundle bytes as InteropDataEncoding does', () => {
    expect(computeBundleHash(BUNDLE_DATA)).toBe(BUNDLE_HASH);
  });

  it('derives the bundle salt field from the sender and its salt', () => {
    expect(computeInteropBundleSalt(SENDER, SALT)).toBe(BUNDLE_SALT);
    expectValidationError(() => computeInteropBundleSalt('0x1234', SALT), 'address');
    expectValidationError(() => computeInteropBundleSalt(SENDER, '0x12'), 'salt');
  });
});
