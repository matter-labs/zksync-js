// src/core/rpc/transport.ts

import type { RpcTransport } from './types';

// Ethers: provider.send(method, params)
export function makeTransportFromEthers(provider: {
  send: (m: string, p: unknown[]) => Promise<unknown>;
}): RpcTransport {
  return (m, p = []) => provider.send(m, p);
}

// Viem: client.request({ method, params })
export function makeTransportFromViem(client: {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}): RpcTransport {
  return (m, p = []) => client.request({ method: m, params: p });
}
