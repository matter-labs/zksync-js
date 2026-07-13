import type { AbstractProvider } from 'ethers';
import type { AtomicInteropIndexProvider } from '../../../../core/types/flows/interop';

/** String URL or live provider — used only in resource/SDK config. */
export type ChainRef = string | AbstractProvider;

/** One-time configuration for the interop resource. */
export interface InteropConfig {
  /** Required for state-changing atomic sends while completion/refund tooling is external. */
  enableExperimentalAtomicSend?: boolean;
  /** Optional indexer-backed predecessor resolver for large commitment trees. */
  indexProvider?: AtomicInteropIndexProvider;
}
