import { createPublicClient, http, type PublicClient } from 'viem';
import type { ChainRef } from './types';

/** Resolve a chain ref (URL string or PublicClient) into a PublicClient. */
export function resolveChainRef(ref: ChainRef): PublicClient {
  if (typeof ref === 'string') {
    return createPublicClient({ transport: http(ref) });
  }
  return ref;
}
