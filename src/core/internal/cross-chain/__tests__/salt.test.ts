import { describe, expect, it } from 'bun:test';

import { generateBundleSalt } from '../salt';

describe('cross-chain bundle salt', () => {
  it('encodes exactly 32 random bytes', () => {
    const salt = generateBundleSalt((length) => {
      expect(length).toBe(32);
      return new Uint8Array(length).fill(0xab);
    });

    expect(salt).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('rejects generators that return the wrong number of bytes', () => {
    expect(() => generateBundleSalt(() => new Uint8Array(31))).toThrow(/expected 32/);
  });
});
