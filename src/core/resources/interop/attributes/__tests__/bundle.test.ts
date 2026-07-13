// tests/interop/attributes/bundle.test.ts
import { describe, it, expect } from 'bun:test';
import { createBundleAttributes } from '../bundle';
import type { AttributesCodec } from '../types';
import type { Address, Hex } from '../../../../types/primitives';

const ADDR_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;

describe('interop/attributes/bundle', () => {
  describe('createBundleAttributes', () => {
    const mockCodec: AttributesCodec = {
      encode: (fn: string, args: readonly unknown[]): Hex => {
        return `0x${fn}:${JSON.stringify(args)}` as Hex;
      },
    };

    it('creates executionAddress attribute', () => {
      const bundle = createBundleAttributes(mockCodec);
      const result = bundle.executionAddress(ADDR_A);

      expect(result).toBe(`0xexecutionAddress:["${ADDR_A}"]`);
    });

    it('creates useFixedFee attribute', () => {
      const bundle = createBundleAttributes(mockCodec);
      expect(bundle.useFixedFee(true)).toBe('0xuseFixedFee:[true]');
      expect(bundle.useFixedFee(false)).toBe('0xuseFixedFee:[false]');
    });

    it('creates interopBundleSalt attribute', () => {
      const bundle = createBundleAttributes(mockCodec);
      const salt = `0x${'11'.repeat(32)}` as Hex;
      expect(bundle.interopBundleSalt(salt)).toBe(`0xinteropBundleSalt:["${salt}"]`);
    });

    it('passes correct function names to codec', () => {
      const calls: { fn: string; args: readonly unknown[] }[] = [];
      const trackingCodec: AttributesCodec = {
        encode: (fn, args) => {
          calls.push({ fn, args });
          return '0x' as Hex;
        },
      };

      const bundle = createBundleAttributes(trackingCodec);
      bundle.executionAddress(ADDR_A);
      bundle.useFixedFee(true);
      bundle.interopBundleSalt(`0x${'22'.repeat(32)}` as Hex);
      bundle.atomicBundle(`0x${'33'.repeat(32)}` as Hex, 123n, 4n);

      expect(calls).toHaveLength(4);
      expect(calls[0].fn).toBe('executionAddress');
      expect(calls[0].args).toEqual([ADDR_A]);
      expect(calls[1].fn).toBe('useFixedFee');
      expect(calls[1].args).toEqual([true]);
      expect(calls[2].fn).toBe('interopBundleSalt');
      expect(calls[2].args).toEqual([`0x${'22'.repeat(32)}`]);
      expect(calls[3].fn).toBe('atomicBundle');
      expect(calls[3].args).toEqual([`0x${'33'.repeat(32)}`, 123n, 4n]);
    });
  });
});
