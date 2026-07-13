import type { AbstractProvider } from 'ethers';

/** String URL or live provider — used only in resource/SDK config. */
export type ChainRef = string | AbstractProvider;

/** One-time configuration for the interop resource. */
export interface InteropConfig {
  /** @deprecated Interop no longer uses a gateway. This value is accepted and ignored. */
  gwChain?: ChainRef;
}
