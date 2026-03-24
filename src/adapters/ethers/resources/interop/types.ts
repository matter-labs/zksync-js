import type { AbstractProvider } from 'ethers';

/** String URL or live provider — used only in resource/SDK config. */
export type ChainRef = string | AbstractProvider;

/** One-time configuration for the interop resource. */
export interface InteropConfig {
  /** Gateway chain — used to fetch GW chain ID for interop root polling. */
  gwChain: ChainRef;
}
