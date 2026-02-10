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
  status(input: InteropWaitable): Promise<InteropStatus>;
  wait(
    input: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;
  finalize(info: InteropFinalizationInfo): Promise<InteropFinalizationResult>;
}

export function createInteropFinalizationServices(
  client: EthersClient,
): InteropFinalizationServices {
  return {
    status(input) {
      return getStatus(client, input);
    },

    wait(input, opts) {
      return waitForFinalization(client, input, opts);
    },

    async finalize(info) {
      const execResult = await executeBundle(client, info);
      await execResult.wait();

      return {
        bundleHash: info.bundleHash,
        dstChainId: info.dstChainId,
        dstExecTxHash: execResult.hash,
      };
    },
  };
}
