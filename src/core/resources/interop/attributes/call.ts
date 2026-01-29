// src/core/interop/attributes/call.ts
import type { Hex } from '../../../types/primitives';
import type { AttributesCodec } from './types';

export function createCallAttributes(codec: AttributesCodec) {
  const indirectCall = (messageValue: bigint): Hex => codec.encode('indirectCall', [messageValue]);

  const interopCallValue = (bridgedAmount: bigint): Hex =>
    codec.encode('interopCallValue', [bridgedAmount]);

  return {
    indirectCall,
    interopCallValue,
  };
}
