import type { AbstractProvider } from 'ethers';
import type {
  InteropStatus,
  InteropWaitable,
  InteropFinalizationInfo,
  InteropFinalizationResult,
} from '../../../../../../core/types/flows/interop';
import type { EthersClient } from '../../../../client';
import { executeBundle } from './bundle';
import { waitForFinalization } from './polling';
import { getStatus } from './status';
import type { LogsQueryOptions } from './data-fetchers';

export interface InteropFinalizationServices {
  status(
    dstProvider: AbstractProvider,
    input: InteropWaitable,
    opts?: LogsQueryOptions,
  ): Promise<InteropStatus>;
  wait(
    dstProvider: AbstractProvider,
    input: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;
  finalize(
    dstProvider: AbstractProvider,
    info: InteropFinalizationInfo,
    opts?: LogsQueryOptions,
  ): Promise<InteropFinalizationResult>;
}

export function createInteropFinalizationServices(
  client: EthersClient,
): InteropFinalizationServices {
  return {
    status(dstProvider, input, opts) {
      return getStatus(client, dstProvider, input, opts);
    },

    wait(dstProvider, input, opts) {
      return waitForFinalization(client, dstProvider, input, opts);
    },

    async finalize(dstProvider, info, opts) {
      const execResult = await executeBundle(client, dstProvider, info, opts);
      await execResult.wait();

      return {
        bundleHash: info.bundleHash,
        dstExecTxHash: execResult.hash,
      };
    },
  };
}
