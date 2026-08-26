import { describe, it, expect } from 'bun:test';
import { isAddressEq, isETH, normalizeAddrEq } from '../addr';
import { isHash66 } from '../hash';
import { ETH_ADDRESS, FORMAL_ETH_ADDRESS, L2_BASE_TOKEN_ADDRESS } from '../../constants';

// Helpers
const aChecksummed = '0x36615Cf349d7F6344891B1e7CA7C72883F5dc049';
const aLower = aChecksummed.toLowerCase();
const bChecksummed = '0x52908400098527886E0F7030069857D2E4169EE7';
const bLower = bChecksummed.toLowerCase();

describe('utils/addr.isHash66', () => {
  it('returns true for 0x-prefixed 32-byte (66-char) strings', () => {
    expect(isHash66('0x' + 'a'.repeat(64))).toBe(true);
    expect(isHash66('0x' + 'A'.repeat(64))).toBe(true);
  });

  it('returns false for non-66 length or missing 0x', () => {
    expect(isHash66(undefined)).toBe(false);
    expect(isHash66('')).toBe(false);
    expect(isHash66('0x' + 'a'.repeat(63))).toBe(false);
    expect(isHash66('0x' + 'a'.repeat(65))).toBe(false);
    expect(isHash66('a'.repeat(64))).toBe(false); // no 0x
  });
});

describe('utils/addr.isAddressEq', () => {
  it('treats casing as equal', () => {
    expect(isAddressEq(aChecksummed, aLower as `0x${string}`)).toBe(true);
    expect(isAddressEq(bChecksummed, bLower as `0x${string}`)).toBe(true);
  });

  it('different addresses are not equal', () => {
    expect(isAddressEq(aChecksummed, bChecksummed)).toBe(false);
  });
});

describe('utils/addr.isETH', () => {
  it('returns true for all ETH alias addresses', () => {
    // Casing-insensitivity check
    expect(isETH(FORMAL_ETH_ADDRESS)).toBe(true);
    expect(isETH(L2_BASE_TOKEN_ADDRESS)).toBe(true);
    expect(isETH(ETH_ADDRESS)).toBe(true);
    expect(isETH(FORMAL_ETH_ADDRESS.toLowerCase() as `0x${string}`)).toBe(true);
  });

  it('returns false for non-ETH addresses', () => {
    expect(isETH(aChecksummed)).toBe(false);
    expect(isETH(bChecksummed)).toBe(false);
  });
});

describe('utils/addr.normalizeAddrEq', () => {
  it('normalizes and compares addresses irrespective of 0x prefix and case', () => {
    // Same address, different case + missing 0x on one side
    const noPrefix = aLower.slice(2);
    expect(normalizeAddrEq(aChecksummed, noPrefix)).toBe(true);
    expect(normalizeAddrEq(aLower, aChecksummed)).toBe(true);
    expect(normalizeAddrEq(noPrefix, aLower)).toBe(true);
  });

  it('returns false for undefined or different values', () => {
    expect(normalizeAddrEq(undefined, aChecksummed)).toBe(false);
    expect(normalizeAddrEq(aChecksummed, undefined)).toBe(false);
    expect(normalizeAddrEq(aChecksummed, bChecksummed)).toBe(false);
  });

  it("is tolerant of input that isn't strictly validated", () => {
    expect(normalizeAddrEq('abc', '0xABC')).toBe(true);
  });
});
