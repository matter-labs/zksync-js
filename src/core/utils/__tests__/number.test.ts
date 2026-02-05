import { describe, it, expect } from 'bun:test';
import { isBigint, isNumber } from '../number';

describe('utils/number.isNumber', () => {
  it('returns true for finite numbers', () => {
    expect(isNumber(0)).toBe(true);
    expect(isNumber(42)).toBe(true);
    expect(isNumber(-1.5)).toBe(true);
  });

  it('returns false for non-number values or non-finite numbers', () => {
    expect(isNumber('42')).toBe(false);
    expect(isNumber(42n)).toBe(false);
    expect(isNumber(NaN)).toBe(false);
    expect(isNumber(Infinity)).toBe(false);
    expect(isNumber(-Infinity)).toBe(false);
    expect(isNumber(undefined)).toBe(false);
  });
});

describe('utils/number.isBigint', () => {
  it('returns true for bigint values', () => {
    expect(isBigint(0n)).toBe(true);
    expect(isBigint(42n)).toBe(true);
  });

  it('returns false for non-bigint values', () => {
    expect(isBigint(0)).toBe(false);
    expect(isBigint('42')).toBe(false);
    expect(isBigint(undefined)).toBe(false);
    expect(isBigint(null)).toBe(false);
  });
});
