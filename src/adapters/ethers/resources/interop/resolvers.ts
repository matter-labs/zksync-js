import { type AbstractProvider, JsonRpcProvider } from 'ethers';
import type { ChainRef } from './types';

/** Resolve a chain ref (URL string or provider) into an AbstractProvider. */
export function resolveChainRef(ref: ChainRef): AbstractProvider {
  return typeof ref === 'string' ? new JsonRpcProvider(ref) : ref;
}
