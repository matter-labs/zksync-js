import type { PublicClient } from 'viem';

/** String URL or live PublicClient — used only in resource/SDK config. */
export type ChainRef = string | PublicClient;

/** One-time configuration for the interop resource. */
export interface InteropConfig {
  /** Gateway chain — used to fetch GW chain ID for interop root polling. */
  gwChain: ChainRef;
}
