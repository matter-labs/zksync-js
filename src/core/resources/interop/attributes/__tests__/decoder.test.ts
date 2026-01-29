// tests/interop/attributes/decoder.test.ts
import { describe, it, expect } from 'bun:test';
import { createAttributesDecoder } from '../decoder';
import type { AttributesCodec } from '../types';
import type { DecodedAttribute } from '../../../../types/flows/interop';
import type { Hex } from '../../../../types/primitives';

describe('interop/attributes/decoder', () => {
  describe('createAttributesDecoder', () => {
    const createMockCodec = (decodeFn?: (attr: Hex) => DecodedAttribute): AttributesCodec => ({
      encode: () => '0x' as Hex,
      decode:
        decodeFn ??
        ((attr: Hex): DecodedAttribute => ({
          selector: attr.slice(0, 10) as Hex,
          name: `decoded_${attr.slice(2, 6)}`,
          args: [attr],
        })),
    });

    describe('call decoder', () => {
      it('decodes empty call attributes', () => {
        const decoder = createAttributesDecoder(createMockCodec());
        const result = decoder.call([]);
        expect(result).toEqual([]);
      });

      it('decodes single call attribute', () => {
        const decoder = createAttributesDecoder(createMockCodec());
        const result = decoder.call(['0xabcd1234' as Hex]);

        expect(result).toHaveLength(1);
        expect(result[0].selector).toBe('0xabcd1234');
        expect(result[0].name).toBe('decoded_abcd');
      });

      it('decodes multiple call attributes', () => {
        const decoder = createAttributesDecoder(createMockCodec());
        const result = decoder.call(['0x11111111' as Hex, '0x22222222' as Hex, '0x33333333' as Hex]);

        expect(result).toHaveLength(3);
        expect(result[0].name).toBe('decoded_1111');
        expect(result[1].name).toBe('decoded_2222');
        expect(result[2].name).toBe('decoded_3333');
      });
    });

    describe('bundle decoder', () => {
      it('decodes empty bundle attributes', () => {
        const decoder = createAttributesDecoder(createMockCodec());
        const result = decoder.bundle([]);
        expect(result).toEqual([]);
      });

      it('decodes single bundle attribute', () => {
        const decoder = createAttributesDecoder(createMockCodec());
        const result = decoder.bundle(['0xbund1234' as Hex]);

        expect(result).toHaveLength(1);
        expect(result[0].selector).toBe('0xbund1234');
        expect(result[0].name).toBe('decoded_bund');
      });

      it('decodes multiple bundle attributes', () => {
        const decoder = createAttributesDecoder(createMockCodec());
        const result = decoder.bundle(['0xaaaa0000' as Hex, '0xbbbb0000' as Hex]);

        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('decoded_aaaa');
        expect(result[1].name).toBe('decoded_bbbb');
      });
    });

    describe('summarize', () => {
      it('returns summary with both call and bundle decoded', () => {
        const decoder = createAttributesDecoder(createMockCodec());
        const result = decoder.summarize(['0xcall1111' as Hex], ['0xbndl2222' as Hex]);

        expect(result.call).toHaveLength(1);
        expect(result.call[0].name).toBe('decoded_call');
        expect(result.bundle).toHaveLength(1);
        expect(result.bundle[0].name).toBe('decoded_bndl');
      });

      it('handles empty arrays in summary', () => {
        const decoder = createAttributesDecoder(createMockCodec());
        const result = decoder.summarize([], []);

        expect(result.call).toEqual([]);
        expect(result.bundle).toEqual([]);
      });

      it('handles asymmetric arrays in summary', () => {
        const decoder = createAttributesDecoder(createMockCodec());
        const result = decoder.summarize(
          ['0x11110000' as Hex, '0x22220000' as Hex, '0x33330000' as Hex],
          ['0xaaaa0000' as Hex],
        );

        expect(result.call).toHaveLength(3);
        expect(result.bundle).toHaveLength(1);
      });
    });

    it('preserves decoded attribute structure from codec', () => {
      const customCodec = createMockCodec((attr: Hex) => ({
        selector: '0x12345678' as Hex,
        name: 'customFunction',
        signature: 'customFunction(uint256,address)',
        args: [100n, '0xaddr'],
      }));

      const decoder = createAttributesDecoder(customCodec);
      const result = decoder.call(['0xany' as Hex]);

      expect(result[0]).toEqual({
        selector: '0x12345678',
        name: 'customFunction',
        signature: 'customFunction(uint256,address)',
        args: [100n, '0xaddr'],
      });
    });
  });
});
