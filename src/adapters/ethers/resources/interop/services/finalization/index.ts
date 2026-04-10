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
import type { TxGasOverrides } from '../../../../../../core/types/fees';

export interface InteropFinalizationServices {
  status(
    dstProvider: AbstractProvider,
    input: InteropWaitable,
    opts?: LogsQueryOptions,
  ): Promise<InteropStatus>;
  wait(
    dstProvider: AbstractProvider,
    gwProvider: AbstractProvider,
    input: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;
  finalize(
    dstProvider: AbstractProvider,
    info: InteropFinalizationInfo,
    opts?: LogsQueryOptions,
    txOverrides?: TxGasOverrides,
  ): Promise<InteropFinalizationResult>;
}

export function createInteropFinalizationServices(
  client: EthersClient,
): InteropFinalizationServices {
  return {
    status(dstProvider, input, opts) {
      return getStatus(client, dstProvider, input, opts);
    },

    wait(dstProvider, gwProvider, input, opts) {
      return waitForFinalization(client, dstProvider, gwProvider, input, opts);
    },

    async finalize(dstProvider, info, opts, txOverrides) {
      const execResult = await executeBundle(client, dstProvider, info, opts, txOverrides);
      await execResult.wait();

      return {
        bundleHash: info.bundleHash,
        dstExecTxHash: execResult.hash,
      };
    },
  };
}
