import type { TransactionReceipt } from 'ethers';

import type { Hex } from '../../../../../../core/types/primitives';
import type {
  InteropStatus,
  InteropWaitable,
  InteropFinalizationInfo,
} from '../../../../../../core/types/flows/interop';
import type { EthersClient } from '../../../../client';

import { createErrorHandlers } from '../../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../../core/types';
import { deriveInteropStatus } from './status';
import { waitForInteropFinalization } from './polling';
import { executeInteropBundle } from './execute';

const { wrap } = createErrorHandlers('interop');

// Exported service interface
export interface InteropFinalizationServices {
  deriveStatus(input: InteropWaitable): Promise<InteropStatus>;

  waitForFinalization(
    input: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;

  executeBundle(
    info: InteropFinalizationInfo,
  ): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }>;
}

export function createInteropFinalizationServices(
  client: EthersClient,
): InteropFinalizationServices {
  return {
    async deriveStatus(input) {
      return await deriveInteropStatus(client, input);
    },

    async waitForFinalization(input, opts) {
      return await waitForInteropFinalization(client, input, opts);
    },

    async executeBundle(info) {
      return await executeInteropBundle(client, info);
    },
  };
}

// Thin wrappers that the resource factory calls
export async function status(client: EthersClient, h: InteropWaitable): Promise<InteropStatus> {
  return wrap(OP_INTEROP.status, () => deriveInteropStatus(client, h), {
    message: 'Internal error while checking interop status.',
    ctx: { where: 'interop.status' },
  });
}

export async function wait(
  client: EthersClient,
  h: InteropWaitable,
  opts?: { for?: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
): Promise<InteropFinalizationInfo> {
  return wrap(
    OP_INTEROP.wait,
    () =>
      waitForInteropFinalization(client, h, {
        pollMs: opts?.pollMs,
        timeoutMs: opts?.timeoutMs,
      }),
    {
      message: 'Internal error while waiting for interop finalization.',
      ctx: { where: 'interop.wait', for: opts?.for },
    },
  );
}

// Re-export individual functions for direct use
export { deriveInteropStatus } from './status';
export { waitForInteropFinalization } from './polling';
export { executeInteropBundle } from './execute';
