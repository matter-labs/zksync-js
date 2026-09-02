// tests/protocol/semver.test.ts
import { describe, it, expect } from 'bun:test';
import { formatProtocolVersion, packSemver, unpackSemver } from '../semver';

describe('protocol/unpackSemver', () => {
  it('unpacks the layout used by ChainTypeManager.getProtocolVersion', () => {
    // v31.0 → minor in bits 32..63
    expect(unpackSemver(31n << 32n)).toEqual([0, 31, 0]);
    expect(unpackSemver(32n << 32n)).toEqual([0, 32, 0]);
    expect(unpackSemver((32n << 32n) | 5n)).toEqual([0, 32, 5]);
    expect(unpackSemver((1n << 64n) | (2n << 32n) | 3n)).toEqual([1, 2, 3]);
  });

  it('unpacks zero as 0.0.0', () => {
    expect(unpackSemver(0n)).toEqual([0, 0, 0]);
  });

  it('ignores bits above the major field', () => {
    // `getProtocolVersion` returns a uint256 holding a uint96; anything higher is not ours.
    expect(unpackSemver((1n << 200n) | (32n << 32n))).toEqual([0, 32, 0]);
  });

  it('round-trips through packSemver', () => {
    for (const v of [
      [0, 26, 0],
      [0, 31, 7],
      [0, 32, 0],
      [1, 2, 3],
    ] as const) {
      expect(unpackSemver(packSemver(v))).toEqual([...v]);
    }
  });
});

describe('protocol/formatProtocolVersion', () => {
  it('renders major.minor.patch', () => {
    expect(formatProtocolVersion([0, 32, 1])).toBe('0.32.1');
  });
});
