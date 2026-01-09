// src/core/interop/attributes/decoder.ts
import type {
  EncodedCallAttributes,
  EncodedBundleAttributes,
  DecodedAttribute,
  DecodedAttributesSummary,
} from '../../../types/flows/interop';
import type { AttributesCodec } from './types';

export function createAttributesDecoder(codec: AttributesCodec) {
  const call = (attrs: EncodedCallAttributes): DecodedAttribute[] =>
    attrs.map((attr) => codec.decode(attr));

  const bundle = (attrs: EncodedBundleAttributes): DecodedAttribute[] =>
    attrs.map((attr) => codec.decode(attr));

  const summarize = (
    callAttrs: EncodedCallAttributes,
    bundleAttrs: EncodedBundleAttributes,
  ): DecodedAttributesSummary => ({
    call: call(callAttrs),
    bundle: bundle(bundleAttrs),
  });

  return {
    call,
    bundle,
    summarize,
  };
}
