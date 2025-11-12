// src/adapters/ethers/rpc.ts
import type { AbstractProvider, JsonRpcApiProvider } from 'ethers';
import { makeTransportFromEthers } from '../../core/rpc/transport';
import { createZksRpc } from '../../core/rpc/zks';

type SendCapable = { send: (m: string, p: unknown[]) => Promise<unknown> };

// Wrap an ethers provider (JsonRpcProvider or BrowserProvider) to provide ZK Sync-specific RPC methods.
export function zksRpcFromEthers(l2Provider: JsonRpcApiProvider): ReturnType<typeof createZksRpc>;

// Wrap an ethers provider (JsonRpcProvider or BrowserProvider) to provide ZK Sync-specific RPC methods.
export function zksRpcFromEthers(l2Provider: AbstractProvider): ReturnType<typeof createZksRpc>;

// Wrap an ethers provider (JsonRpcProvider or BrowserProvider) to provide ZK Sync-specific RPC methods.
export function zksRpcFromEthers(l2Provider: AbstractProvider) {
  const maybe = l2Provider as Partial<SendCapable>;
  if (typeof maybe.send !== 'function') {
    throw new Error(
      'zksRpcFromEthers requires a JSON-RPC capable provider with .send(method, params). ' +
        'Pass an ethers JsonRpcProvider (or wrap your EIP-1193 provider: new BrowserProvider(window.ethereum)).',
    );
  }
  return createZksRpc(makeTransportFromEthers(maybe as SendCapable));
}
