// src/core/types/flows/interop.ts
import type { Hex } from '../primitives';

export type EncodedCallAttributes = readonly Hex[];
export type EncodedBundleAttributes = readonly Hex[];

export interface DecodedAttribute {
  selector: Hex; // 0x + 8 hex chars (4-byte selector)
  name: string;
  signature?: string; // e.g. "interopCallValue(uint256)" when ABI is known
  args: unknown[];
}

export interface DecodedAttributesSummary {
  call: DecodedAttribute[];
  bundle: DecodedAttribute[];
}
