import { describe, it, expect } from 'bun:test';

import { readSettlementLayerReference, toOnchainImtProof } from '../proof';
import { isZKsyncError } from '../../../../types/errors';
import type { Hex } from '../../../../types/primitives';
import type { ImtProofResponse } from '../../../../types/flows/atomic-interop';

const word = (n: bigint): Hex => `0x${n.toString(16).padStart(64, '0')}`;
const filler = (byte: string): Hex => `0x${byte.repeat(32)}`;

/**
 * A settlement proof laid out as `MessageHashing._getProofData` reads it: the metadata word, the
 * path to the batch root, the batch's timestamp, the batch-leaf mask, the path to the settlement
 * layer's root, then the packed batch information and the settlement layer's chain id.
 */
function settlementProof(
  metadata: [number, number, number, number],
  timestamp: bigint,
  block: bigint,
  chainId: bigint,
): Hex[] {
  const [, toBatchRoot, toSettlementRoot] = metadata;
  const head = metadata.map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    `0x${head}${'00'.repeat(28)}`,
    ...Array.from({ length: toBatchRoot }, () => filler('aa')),
    word(timestamp),
    filler('bb'),
    ...Array.from({ length: toSettlementRoot }, () => filler('cc')),
    word((block << 128n) | 7n),
    word(chainId),
  ];
}

function expectValidationError(fn: () => unknown, messageIncludes: string) {
  try {
    fn();
  } catch (e) {
    expect(isZKsyncError(e, { type: 'VALIDATION', messageIncludes })).toBe(true);
    return;
  }
  throw new Error('expected a validation error');
}

describe('interop/atomic.readSettlementLayerReference', () => {
  it('reads where a proof ends on the settlement layer', () => {
    expect(
      readSettlementLayerReference(settlementProof([1, 3, 2, 0], 1_795_000_000n, 4_321n, 1n)),
    ).toEqual({
      l1BatchTimestamp: 1_795_000_000n,
      settlementLayerBatchNumber: 4_321n,
      settlementLayerChainId: 1n,
    });
  });

  it('reads proofs with empty paths', () => {
    expect(readSettlementLayerReference(settlementProof([1, 0, 0, 0], 5n, 6n, 31337n))).toEqual({
      l1BatchTimestamp: 5n,
      settlementLayerBatchNumber: 6n,
      settlementLayerChainId: 31337n,
    });
  });

  it('refuses an unknown metadata version', () => {
    expectValidationError(
      () => readSettlementLayerReference(settlementProof([2, 3, 2, 0], 1n, 1n, 1n)),
      'metadata version',
    );
  });

  it('refuses a proof that stops at the batch root', () => {
    expectValidationError(
      () => readSettlementLayerReference(settlementProof([1, 3, 0, 1], 1n, 1n, 1n)),
      'stops at the batch root',
    );
    // A legacy proof is a plain Merkle path with no metadata word.
    expectValidationError(
      () => readSettlementLayerReference([filler('ab'), filler('cd')]),
      'no metadata',
    );
  });

  it('refuses a proof shorter than its metadata says, or an empty one', () => {
    const short = settlementProof([1, 3, 2, 0], 1n, 1n, 1n).slice(0, -1);
    expectValidationError(() => readSettlementLayerReference(short), 'shorter');
    expectValidationError(() => readSettlementLayerReference([]), 'empty');
  });

  it('refuses words that are not 32 bytes', () => {
    expectValidationError(() => readSettlementLayerReference(['0x01']), '32 bytes');
  });
});

describe('interop/atomic.toOnchainImtProof', () => {
  it('adds the source chain and passes the rest through', () => {
    const response: ImtProofResponse = {
      batchNumber: 12n,
      settlementBlockNumber: 99n,
      provesAgainstBeginRoot: true,
      chainImtRoot: filler('11'),
      settlementProof: [filler('22')],
      leaf: { value: 1n, nextIndex: 2n, nextValue: 3n },
      imtLeafIndex: 4n,
      imtProof: [filler('33')],
    };
    expect(toOnchainImtProof(response, 7101n)).toEqual({
      sourceChainId: 7101n,
      batchNumber: 12n,
      chainImtRoot: filler('11'),
      provesAgainstBeginRoot: true,
      settlementProof: [filler('22')],
      leaf: { value: 1n, nextIndex: 2n, nextValue: 3n },
      imtLeafIndex: 4n,
      imtProof: [filler('33')],
    });
  });
});
