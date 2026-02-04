import { describe, it, expect } from 'bun:test';
import { isHash, isHashArray, isHash66, isHash66Array } from '../hash';

describe('utils/hash.isHash', () => {
  it('returns true for 0x-prefixed hex strings', () => {
    expect(isHash('0x')).toBe(true);
    expect(isHash('0x12ab')).toBe(true);
    expect(isHash('0x12AB')).toBe(true);
  });

  it('respects expected length when provided', () => {
    expect(isHash('0x12ab', 6)).toBe(true);
    expect(isHash('0x12ab', 8)).toBe(false);
  });

  it('returns false for invalid values', () => {
    expect(isHash(undefined)).toBe(false);
    expect(isHash(null)).toBe(false);
    expect(isHash(123)).toBe(false);
    expect(isHash('12ab')).toBe(false);
    expect(isHash('0x12xz')).toBe(false);
  });
});

describe('utils/hash.isHashArray', () => {
  it('returns true when all items are hashes', () => {
    expect(isHashArray(['0x', '0x12ab'])).toBe(true);
  });

  it('respects expected length for each array item', () => {
    expect(isHashArray(['0xaaaa', '0xbbbb'], 6)).toBe(true);
    expect(isHashArray(['0xaaaa', '0xbbbbb'], 6)).toBe(false);
  });

  it('returns false for non-arrays and invalid items', () => {
    expect(isHashArray('0x12ab')).toBe(false);
    expect(isHashArray({})).toBe(false);
    expect(isHashArray(['0x12ab', 'not-hex'])).toBe(false);
    expect(isHashArray(['0x12ab', 1])).toBe(false);
  });
});

describe('utils/hash.isHash66', () => {
  it('returns true for 32-byte hashes', () => {
    expect(isHash66('0x' + 'a'.repeat(64))).toBe(true);
  });

  it('returns false for wrong length or format', () => {
    expect(isHash66('0x' + 'a'.repeat(63))).toBe(false);
    expect(isHash66('0x' + 'z'.repeat(64))).toBe(false);
  });
});

describe('utils/hash.isHash66Array', () => {
  it('returns true when all items are 32-byte hashes', () => {
    expect(isHash66Array(['0x' + 'a'.repeat(64), '0x' + 'b'.repeat(64)])).toBe(true);
  });

  it('returns false when at least one item is invalid', () => {
    expect(isHash66Array(['0x' + 'a'.repeat(64), '0x' + 'b'.repeat(63)])).toBe(false);
    expect(isHash66Array('0x' + 'a'.repeat(64))).toBe(false);
  });
});
