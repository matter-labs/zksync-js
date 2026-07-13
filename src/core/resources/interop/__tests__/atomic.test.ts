import { describe, expect, it } from 'bun:test';
import type {
  AtomicInteropIntent,
  AtomicInteropLegDraft,
  InteropParams,
} from '../../../types/flows/interop';
import type { Hex } from '../../../types/primitives';
import {
  ATOMIC_COMMIT_LEAF_TAG,
  assertAtomicInteropIntent,
  assertAtomicInteropPayloadMatches,
  assertInteropParams,
  bindAtomicInteropFlow,
  decodeAtomicInteropBundleState,
  decodeAtomicInteropLegState,
  defineAtomicInteropFlow,
  getAtomicInteropCommitValue,
  hashAtomicInteropFlow,
  isStaleAtomicInteropIndexErrorName,
  mapAtomicInteropPhase,
  resolveAtomicInteropIndex,
  withAtomicBundleAttribute,
  type AtomicInteropTreeLeaf,
} from '../atomic';

const HASH_1 = `0x${'11'.repeat(32)}` as Hex;
const HASH_2 = `0x${'22'.repeat(32)}` as Hex;
const SENDER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const RECIPIENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const DEADLINE = 1_900_000_000n;

function draft(overrides: Partial<AtomicInteropLegDraft> = {}): AtomicInteropLegDraft {
  const params: InteropParams = {
    actions: [
      {
        type: 'call',
        to: RECIPIENT,
        data: '0x1234',
        recovery: { protocol: 'IAtomicRecoverable' },
      },
    ],
    deadline: DEADLINE,
    settlementLayerChainId: 1n,
  };
  return {
    kind: 'atomic-interop-leg',
    version: 1,
    sender: SENDER,
    sourceChainId: 324n,
    destinationChainId: 270n,
    settlementLayerChainId: 1n,
    deadline: DEADLINE,
    salt: `0x${'aa'.repeat(32)}`,
    route: 'direct',
    params,
    payload: {
      destinationChain: '0x01',
      starters: [['0x02', '0x1234', []]],
      bundleAttributes: ['0x03'],
      value: 0n,
    },
    bundleHash: HASH_1,
    commitment: { bundleHash: HASH_1, sourceChainId: 324n, settlementLayerChainId: 1n },
    ...overrides,
  };
}

describe('atomic interop identifiers', () => {
  it('matches the protocol ABI hash vectors', () => {
    const flowId = hashAtomicInteropFlow({
      legBundleHashes: [HASH_1, HASH_2],
      legSourceChainIds: [324n, 270n],
      deadline: DEADLINE,
      settlementLayerChainId: 1n,
    });
    expect(ATOMIC_COMMIT_LEAF_TAG).toBe('0x3445134c');
    expect(flowId).toBe('0xebc86d7d5941bf0caa903c9eecc123d6ca97bd2f413fd114002e41c206155b36');
    expect(`0x${getAtomicInteropCommitValue(flowId, HASH_1).toString(16).padStart(64, '0')}`).toBe(
      '0x0cb8dbaa64b99f59f8edddf5c136dff3ced7a82c9b7bf5340575c35fe3feb7f4',
    );
  });

  it('sorts bundle/source-chain pairs together and rejects duplicates', () => {
    const flow = defineAtomicInteropFlow({
      legs: [
        { bundleHash: HASH_2, sourceChainId: 270n, settlementLayerChainId: 1n },
        { bundleHash: HASH_1, sourceChainId: 324n, settlementLayerChainId: 1n },
      ],
      deadline: DEADLINE,
    });
    expect(flow.legBundleHashes).toEqual([HASH_1, HASH_2]);
    expect(flow.legSourceChainIds).toEqual([324n, 270n]);
    expect(() =>
      defineAtomicInteropFlow({
        legs: [
          { bundleHash: HASH_1, sourceChainId: 324n },
          { bundleHash: HASH_1, sourceChainId: 270n },
        ],
        deadline: DEADLINE,
        settlementLayerChainId: 1n,
      }),
    ).toThrow(/Duplicate/);
  });

  it('enforces one settlement layer and binds the local leg', () => {
    expect(() =>
      defineAtomicInteropFlow({
        legs: [
          { bundleHash: HASH_1, sourceChainId: 324n, settlementLayerChainId: 1n },
          { bundleHash: HASH_2, sourceChainId: 270n, settlementLayerChainId: 2n },
        ],
        deadline: DEADLINE,
        settlementLayerChainId: 1n,
      }),
    ).toThrow(/same settlement layer/);

    const localDraft = draft();
    const flow = defineAtomicInteropFlow({ legs: [localDraft], deadline: DEADLINE });
    expect(bindAtomicInteropFlow(localDraft, flow).flow.flowId).toBe(flow.flowId);
    expect(() => bindAtomicInteropFlow(draft({ deadline: DEADLINE + 1n }), flow)).toThrow(
      /deadlines do not match/,
    );
  });
});

describe('atomic interop intent validation', () => {
  it('rejects native value, malformed calldata, and missing recovery declarations', () => {
    const base = draft().params;
    expect(() =>
      assertInteropParams({
        ...base,
        actions: [{ ...base.actions[0], value: 1n } as never],
      }),
    ).toThrow(/Native call value/);
    expect(() =>
      assertInteropParams({
        ...base,
        actions: [{ ...base.actions[0], data: '0x1' } as never],
      }),
    ).toThrow(/even-length/);
    expect(() =>
      assertInteropParams({
        ...base,
        actions: [{ type: 'call', to: RECIPIENT, data: '0x' } as never],
      }),
    ).toThrow(/IAtomicRecoverable/);
  });

  it('validates signer and chain ownership for a serializable intent', () => {
    const localDraft = draft();
    const intent: AtomicInteropIntent = bindAtomicInteropFlow(
      localDraft,
      defineAtomicInteropFlow({ legs: [localDraft], deadline: DEADLINE }),
    );
    expect(() =>
      assertAtomicInteropIntent(intent, {
        sender: SENDER,
        sourceChainId: 324n,
        destinationChainId: 270n,
        settlementLayerChainId: 1n,
      }),
    ).not.toThrow();
    expect(() =>
      assertAtomicInteropIntent(intent, {
        sender: RECIPIENT,
        sourceChainId: 324n,
        destinationChainId: 270n,
        settlementLayerChainId: 1n,
      }),
    ).toThrow(/sender/);
  });

  it('rejects inconsistent draft metadata and retained payloads', () => {
    const localDraft = draft();
    const flow = defineAtomicInteropFlow({ legs: [localDraft], deadline: DEADLINE });
    expect(() =>
      bindAtomicInteropFlow(
        draft({
          params: { ...localDraft.params, deadline: DEADLINE + 1n },
        }),
        flow,
      ),
    ).toThrow(/params deadlines/);
    expect(() =>
      bindAtomicInteropFlow(
        draft({
          commitment: { ...localDraft.commitment, bundleHash: HASH_2 },
        }),
        flow,
      ),
    ).toThrow(/commitment/);
    expect(() =>
      bindAtomicInteropFlow(draft({ destinationChainId: localDraft.sourceChainId }), flow),
    ).toThrow(/must differ/);
    expect(() =>
      assertAtomicInteropPayloadMatches(localDraft.payload, {
        ...localDraft.payload,
        value: 1n,
      }),
    ).toThrow(/payload/);
    expect(() => bindAtomicInteropFlow(draft({ commitment: undefined as never }), flow)).toThrow(
      /commitment is missing/,
    );
    expect(() => bindAtomicInteropFlow(draft({ payload: undefined as never }), flow)).toThrow(
      /payload is missing/,
    );
  });

  it('adds atomic metadata without mutating the preview payload', () => {
    const payload = draft().payload;
    const result = withAtomicBundleAttribute(payload, '0x9999');
    expect(result.bundleAttributes).toEqual(['0x03', '0x9999']);
    expect(payload.bundleAttributes).toEqual(['0x03']);
  });
});

describe('atomic interop predecessor resolution', () => {
  const leaves: AtomicInteropTreeLeaf[] = [
    { value: 0n, nextIndex: 1n, nextValue: 10n },
    { value: 10n, nextIndex: 2n, nextValue: 30n },
    { value: 30n, nextIndex: 0n, nextValue: 0n },
  ];
  const reader = (values = leaves) => ({
    leafCount: async () => BigInt(values.length),
    leafAt: async (index: bigint) => values[Number(index)],
  });

  it('accepts a validated provider result', async () => {
    let reads = 0;
    expect(
      await resolveAtomicInteropIndex({
        target: 20n,
        provider: async () => 1n,
        reader: {
          leafCount: async () => 3n,
          leafAt: async (index) => {
            reads += 1;
            return leaves[Number(index)];
          },
        },
      }),
    ).toBe(1n);
    expect(reads).toBe(1);
  });

  it('falls back from stale provider data to the bounded linked-list walk', async () => {
    expect(
      await resolveAtomicInteropIndex({
        target: 20n,
        provider: async () => 2n,
        reader: reader(),
      }),
    ).toBe(1n);
  });

  it('fails clearly above the configured walk limit', async () => {
    await expect(
      resolveAtomicInteropIndex({ target: 40n, reader: reader(), maxWalk: 2 }),
    ).rejects.toThrow(/exceeded 2 leaves/);
  });

  it('rejects duplicates and malformed linked-list cycles', async () => {
    await expect(resolveAtomicInteropIndex({ target: 10n, reader: reader() })).rejects.toThrow(
      /already exists/,
    );
    await expect(
      resolveAtomicInteropIndex({
        target: 40n,
        reader: reader([
          { value: 0n, nextIndex: 1n, nextValue: 10n },
          { value: 10n, nextIndex: 0n, nextValue: 20n },
        ]),
      }),
    ).rejects.toThrow(/cycle/);
  });

  it('classifies only decoded low-index errors as retryable', () => {
    expect(isStaleAtomicInteropIndexErrorName('IMTLowLeafIndexOutOfBounds')).toBe(true);
    expect(isStaleAtomicInteropIndexErrorName('IMTLowLeafNextTooSmall')).toBe(true);
    expect(isStaleAtomicInteropIndexErrorName('IMTLowLeafValueTooLarge')).toBe(true);
    expect(isStaleAtomicInteropIndexErrorName('IMTValueAlreadyExists')).toBe(false);
  });
});

describe('atomic interop status mapping', () => {
  it.each([
    [0, 0, 'UNSET'],
    [1, 0, 'COMMITTED'],
    [1, 1, 'VERIFIED'],
    [1, 2, 'EXECUTED'],
    [1, 3, 'UNBUNDLED'],
    [2, 0, 'REFUNDABLE'],
    [3, 0, 'REFUNDED'],
    [3, 2, 'INCONSISTENT'],
    [0, 1, 'INCONSISTENT'],
  ] as const)('maps source %s and destination %s to %s', (source, destination, phase) => {
    expect(
      mapAtomicInteropPhase(
        decodeAtomicInteropLegState(source),
        decodeAtomicInteropBundleState(destination),
      ),
    ).toBe(phase);
  });

  it('preserves unknown protocol enum values', () => {
    expect(decodeAtomicInteropLegState(99)).toBe('UNKNOWN');
    expect(decodeAtomicInteropBundleState(99)).toBe('UNKNOWN');
    expect(mapAtomicInteropPhase('UNKNOWN', 'UNRECEIVED')).toBe('UNKNOWN');
  });
});
