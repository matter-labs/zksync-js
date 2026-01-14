// src/core/interop/attributes/call.ts
import type { Hex } from '../../../types/primitives';
import type { AttributesCodec } from './types';

export function createCallAttributes(codec: AttributesCodec) {
  const indirectCall = (messageValue: bigint): Hex => codec.encode('indirectCall', [messageValue]);

  const interopCallValue = (bridgedAmount: bigint): Hex =>
    codec.encode('interopCallValue', [bridgedAmount]);

  const nativeBridge = (messageValue: bigint, bridgedAmount: bigint): readonly Hex[] => [
    indirectCall(messageValue),
    interopCallValue(bridgedAmount),
  ];

  return {
    indirectCall,
    interopCallValue,
    nativeBridge,
  };
}
