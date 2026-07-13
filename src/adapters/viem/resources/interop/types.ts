import type { PublicClient } from 'viem';

/** String URL or live PublicClient — used only in resource/SDK config. */
export type ChainRef = string | PublicClient;

/** One-time configuration for the interop resource. */
export interface InteropConfig {
  /** @deprecated Interop no longer uses a gateway. This value is accepted and ignored. */
  gwChain?: ChainRef;
}
