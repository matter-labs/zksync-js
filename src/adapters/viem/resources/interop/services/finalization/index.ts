import type { PublicClient } from 'viem';
import type {
  InteropStatus,
  InteropWaitable,
  InteropFinalizationInfo,
  InteropFinalizationResult,
} from '../../../../../../core/types/flows/interop';
import type { ViemClient } from '../../../../client';
import { executeBundle } from './bundle';
import { waitForFinalization } from './polling';
import { getStatus } from './status';
import type { LogsQueryOptions } from './data-fetchers';
import type { TxGasOverrides } from '../../../../../../core/types/fees';

type PollOptions = { pollMs?: number; timeoutMs?: number };

function isInteropWaitable(value: unknown): value is InteropWaitable {
  if (typeof value === 'string') return true;
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === 'interop' ||
    'l2SrcTxHash' in candidate ||
    'bundleHash' in candidate ||
    'dstExecTxHash' in candidate
  );
}

export interface InteropFinalizationServices {
  status(
    dstProvider: PublicClient,
    input: InteropWaitable,
    opts?: LogsQueryOptions,
  ): Promise<InteropStatus>;
  wait(
    dstProvider: PublicClient,
    input: InteropWaitable,
    opts?: PollOptions,
  ): Promise<InteropFinalizationInfo>;
  /** @deprecated The gateway provider argument is ignored. */
  wait(
    dstProvider: PublicClient,
    legacyGatewayProvider: PublicClient,
    input: InteropWaitable,
    opts?: PollOptions,
  ): Promise<InteropFinalizationInfo>;
  finalize(
    dstProvider: PublicClient,
    info: InteropFinalizationInfo,
    opts?: LogsQueryOptions,
    txOverrides?: TxGasOverrides,
  ): Promise<InteropFinalizationResult>;
}

/** @deprecated Use the `sdk.interop` intent resource methods instead. */
export function createInteropFinalizationServices(client: ViemClient): InteropFinalizationServices {
  const wait = (
    dstProvider: PublicClient,
    inputOrLegacyProvider: InteropWaitable | PublicClient,
    inputOrOptions?: InteropWaitable | PollOptions,
    legacyOptions?: PollOptions,
  ): Promise<InteropFinalizationInfo> => {
    const legacyCall = !isInteropWaitable(inputOrLegacyProvider);
    const input = (legacyCall ? inputOrOptions : inputOrLegacyProvider) as InteropWaitable;
    const options = (legacyCall ? legacyOptions : inputOrOptions) as PollOptions | undefined;
    return waitForFinalization(client, dstProvider, input, options);
  };

  return {
    status(dstProvider, input, opts) {
      return getStatus(client, dstProvider, input, opts);
    },

    wait,

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
