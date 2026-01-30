// tests/interop/attributes/bundle.test.ts
import { describe, it, expect } from 'bun:test';
import { createBundleAttributes } from '../bundle';
import type { AttributesCodec } from '../types';
import type { Address, Hex } from '../../../../types/primitives';

const ADDR_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const ADDR_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;

describe('interop/attributes/bundle', () => {
  describe('createBundleAttributes', () => {
    const mockCodec: AttributesCodec = {
      encode: (fn: string, args: readonly unknown[]): Hex => {
        return `0x${fn}:${JSON.stringify(args)}` as Hex;
      },
      decode: () => ({ selector: '0x00000000', name: 'mock', args: [] }),
    };

    it('creates executionAddress attribute', () => {
      const bundle = createBundleAttributes(mockCodec);
      const result = bundle.executionAddress(ADDR_A);

      expect(result).toBe(`0xexecutionAddress:["${ADDR_A}"]`);
    });

    it('creates unbundlerAddress attribute', () => {
      const bundle = createBundleAttributes(mockCodec);
      const result = bundle.unbundlerAddress(ADDR_B);

      expect(result).toBe(`0xunbundlerAddress:["${ADDR_B}"]`);
    });

    it('passes correct function names to codec', () => {
      const calls: { fn: string; args: readonly unknown[] }[] = [];
      const trackingCodec: AttributesCodec = {
        encode: (fn, args) => {
          calls.push({ fn, args });
          return '0x' as Hex;
        },
        decode: () => ({ selector: '0x00000000', name: 'mock', args: [] }),
      };

      const bundle = createBundleAttributes(trackingCodec);
      bundle.executionAddress(ADDR_A);
      bundle.unbundlerAddress(ADDR_B);

      expect(calls).toHaveLength(2);
      expect(calls[0].fn).toBe('executionAddress');
      expect(calls[0].args).toEqual([ADDR_A]);
      expect(calls[1].fn).toBe('unbundlerAddress');
      expect(calls[1].args).toEqual([ADDR_B]);
    });
  });
});
