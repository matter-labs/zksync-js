// tests/interop/attributes/call.test.ts
import { describe, it, expect } from 'bun:test';
import { createCallAttributes } from '../call';
import type { AttributesCodec } from '../types';
import type { Hex } from '../../../../types/primitives';
import { isBigint } from '../../../../utils';

describe('interop/attributes/call', () => {
  describe('createCallAttributes', () => {
    const mockCodec: AttributesCodec = {
      encode: (fn: string, args: readonly unknown[]): Hex => {
        // Convert BigInt to string for serialization
        const serializable = args.map((a) => (isBigint(a) ? a.toString() : a));
        return `0x${fn}:${JSON.stringify(serializable)}` as Hex;
      },
      decode: () => ({ selector: '0x00000000', name: 'mock', args: [] }),
    };

    it('creates indirectCall attribute with message value', () => {
      const call = createCallAttributes(mockCodec);
      const result = call.indirectCall(1000n);

      // BigInt serializes to string in JSON
      expect(result).toContain('indirectCall');
      expect(result).toContain('1000');
    });

    it('creates interopCallValue attribute with bridged amount', () => {
      const call = createCallAttributes(mockCodec);
      const result = call.interopCallValue(500n);

      expect(result).toContain('interopCallValue');
      expect(result).toContain('500');
    });

    it('passes correct function names and args to codec', () => {
      const calls: { fn: string; args: readonly unknown[] }[] = [];
      const trackingCodec: AttributesCodec = {
        encode: (fn, args) => {
          calls.push({ fn, args });
          return '0x' as Hex;
        },
        decode: () => ({ selector: '0x00000000', name: 'mock', args: [] }),
      };

      const call = createCallAttributes(trackingCodec);
      call.indirectCall(100n);
      call.interopCallValue(200n);

      expect(calls).toHaveLength(2);
      expect(calls[0].fn).toBe('indirectCall');
      expect(calls[0].args).toEqual([100n]);
      expect(calls[1].fn).toBe('interopCallValue');
      expect(calls[1].args).toEqual([200n]);
    });

    it('handles zero values', () => {
      const call = createCallAttributes(mockCodec);

      const indirectResult = call.indirectCall(0n);
      const valueResult = call.interopCallValue(0n);

      expect(indirectResult).toContain('0');
      expect(valueResult).toContain('0');
    });

    it('handles large values', () => {
      const calls: { fn: string; args: readonly unknown[] }[] = [];
      const trackingCodec: AttributesCodec = {
        encode: (fn, args) => {
          calls.push({ fn, args });
          return '0x' as Hex;
        },
        decode: () => ({ selector: '0x00000000', name: 'mock', args: [] }),
      };

      const call = createCallAttributes(trackingCodec);
      const largeValue = 10n ** 30n;
      call.indirectCall(largeValue);

      expect(calls[0].args).toEqual([largeValue]);
    });
  });
});
