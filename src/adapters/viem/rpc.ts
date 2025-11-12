// src/adapters/viem/rpc.ts
import type { PublicClient } from 'viem';
import { createZksRpc } from '../../core/rpc/zks';
import { makeTransportFromViem } from '../../core/rpc/transport';

// Viem-native client → ZK RPC wrapper
// TODO: revist ugly type casting here
export function zksRpcFromViem(l2Client: PublicClient) {
  const compatible = {
    request: (args: { method: string; params?: unknown[] }) =>
      (
        l2Client.request as unknown as (a: {
          method: string;
          params?: unknown[];
        }) => Promise<unknown>
      )(args),
  };

  return createZksRpc(makeTransportFromViem(compatible));
}
