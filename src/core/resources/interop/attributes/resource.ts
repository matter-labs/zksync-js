// src/core/interop/attributes/resource.ts
import { createCallAttributes } from './call';
import { createBundleAttributes } from './bundle';
import type { AttributesCodec } from './types';

export function createAttributesResource(codec: AttributesCodec) {
  return {
    call: createCallAttributes(codec),
    bundle: createBundleAttributes(codec),
  };
}

export type AttributesResource = ReturnType<typeof createAttributesResource>;
