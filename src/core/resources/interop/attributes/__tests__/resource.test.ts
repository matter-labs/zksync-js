// tests/interop/attributes/resource.test.ts
import { describe, it, expect } from 'bun:test';
import { createAttributesResource } from '../resource';
import type { AttributesCodec } from '../types';
import type { Address, Hex } from '../../../../types/primitives';

const ADDR_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;

describe('interop/attributes/resource', () => {
  describe('createAttributesResource', () => {
    const mockCodec: AttributesCodec = {
      encode: (fn: string, args: readonly unknown[]): Hex => {
        return `0xenc:${fn}` as Hex;
      },
      decode: (attr: Hex) => ({
        selector: attr.slice(0, 10) as Hex,
        name: 'decoded',
        args: [],
      }),
    };

    it('creates resource with call and bundle methods', () => {
      const resource = createAttributesResource(mockCodec);

      expect(resource.call).toBeDefined();
      expect(resource.bundle).toBeDefined();
    });

    it('call methods are functional', () => {
      const resource = createAttributesResource(mockCodec);

      expect(resource.call.indirectCall(100n)).toBe('0xenc:indirectCall');
      expect(resource.call.interopCallValue(200n)).toBe('0xenc:interopCallValue');
    });

    it('bundle methods are functional', () => {
      const resource = createAttributesResource(mockCodec);

      expect(resource.bundle.executionAddress(ADDR_A)).toBe('0xenc:executionAddress');
      expect(resource.bundle.unbundlerAddress(ADDR_A)).toBe('0xenc:unbundlerAddress');
    });

    it('uses the same codec instance for all sub-resources', () => {
      const encodeCalls: string[] = [];
      const decodeCalls: string[] = [];

      const trackingCodec: AttributesCodec = {
        encode: (fn, args) => {
          encodeCalls.push(fn);
          return '0x' as Hex;
        },
        decode: (attr) => {
          decodeCalls.push(attr);
          return { selector: '0x00000000' as Hex, name: 'mock', args: [] };
        },
      };

      const resource = createAttributesResource(trackingCodec);

      // Use all encode methods
      resource.call.indirectCall(1n);
      resource.call.interopCallValue(2n);
      resource.bundle.executionAddress(ADDR_A);
      resource.bundle.unbundlerAddress(ADDR_A);

      expect(encodeCalls).toEqual([
        'indirectCall',
        'interopCallValue',
        'executionAddress',
        'unbundlerAddress',
      ]);
    });
  });
});
