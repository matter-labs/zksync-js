// src/adapters/ethers/resources/withdrawals/services/protocol.ts
//
// Per-client, cached detection of the chain's withdrawal protocol.

import type { EthersClient } from '../../../client';
import type { Address } from '../../../../../core/types/primitives';
import {
  detectWithdrawalProtocol,
  type WithdrawalProtocol,
  type WithdrawalProtocolDetection,
} from '../../../../../core/resources/withdrawals/protocol';

export interface WithdrawalProtocolService {
  /** Cached detection for the connected L2. */
  detect(): Promise<WithdrawalProtocolDetection>;
  /** Convenience wrapper around {@link detect}. */
  protocol(): Promise<WithdrawalProtocol>;
  /** Drop the cached result (e.g. after a chain upgrade during a long-lived session). */
  refresh(): void;
}

export function createWithdrawalProtocolService(
  client: EthersClient,
  override?: WithdrawalProtocol,
): WithdrawalProtocolService {
  // Detection costs up to three RPC round-trips and the answer only changes when the chain is
  // upgraded, so it is cached for the client's lifetime. The promise itself is cached so concurrent
  // callers share one in-flight detection.
  let cached: Promise<WithdrawalProtocolDetection> | undefined;

  async function hasCodeAt(address: Address): Promise<boolean> {
    try {
      const code = await client.l2.getCode(address);
      return !!code && code !== '0x';
    } catch {
      return false;
    }
  }

  function detect(): Promise<WithdrawalProtocolDetection> {
    cached ??= detectWithdrawalProtocol(
      {
        protocolVersion: () => client.getChainProtocolVersion(),
        hasCodeAt,
      },
      override,
    ).catch((e: unknown) => {
      // Never poison the cache with a rejection: a transient RPC failure should not permanently
      // break withdrawals for this client.
      cached = undefined;
      throw e;
    });
    return cached;
  }

  return {
    detect,
    async protocol() {
      return (await detect()).protocol;
    },
    refresh() {
      cached = undefined;
    },
  };
}
