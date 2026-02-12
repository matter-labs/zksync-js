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

export interface InteropFinalizationServices {
  status(dstProvider: AbstractProvider, input: InteropWaitable): Promise<InteropStatus>;
  wait(
    dstProvider: AbstractProvider,
    input: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;
  finalize(
    dstProvider: AbstractProvider,
    info: InteropFinalizationInfo,
  ): Promise<InteropFinalizationResult>;
}

export function createInteropFinalizationServices(
  client: EthersClient,
): InteropFinalizationServices {
  return {
    status(dstProvider, input) {
      return getStatus(client, dstProvider, input);
    },

    wait(dstProvider, input, opts) {
      return waitForFinalization(client, dstProvider, input, opts);
    },

    async finalize(dstProvider, info) {
      const execResult = await executeBundle(client, dstProvider, info);
      await execResult.wait();

      return {
        bundleHash: info.bundleHash,
        dstExecTxHash: execResult.hash,
      };
    },
  };
}
