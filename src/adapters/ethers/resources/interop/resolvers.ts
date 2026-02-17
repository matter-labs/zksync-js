import { type AbstractProvider, JsonRpcProvider } from 'ethers';
import type { InteropWaitable as InteropWaitableBase } from '../../../../core/types/flows/interop';
import type { DstChain, InteropWaitable, InteropHandle } from './types';

/** Resolve a destination chain input (URL string or provider) into an AbstractProvider. */
export function resolveDstProvider(dstChain: DstChain): AbstractProvider {
  return typeof dstChain === 'string' ? new JsonRpcProvider(dstChain) : dstChain;
}

export function resolveWaitableInput(waitableInput: InteropWaitable): {
  dstProvider: AbstractProvider;
  waitable: InteropWaitableBase;
} {
  const input = waitableInput as { waitable?: InteropWaitableBase };
  return {
    dstProvider: resolveDstProvider(waitableInput.dstChain),
    waitable: input.waitable ? input.waitable : (waitableInput as InteropHandle<unknown>),
  };
}
