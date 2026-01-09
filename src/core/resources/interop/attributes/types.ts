// src/core/interop/attributes/types.ts
import type { Hex } from '../../../types/primitives';
import type { DecodedAttribute } from '../../../types/flows/interop';

export interface AttributesCodec {
  encode(fn: string, args: readonly unknown[]): Hex;
  decode(attr: Hex): DecodedAttribute;
}
