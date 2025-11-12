// src/core/index.ts
export {
  ETH_ADDRESS,
  FORMAL_ETH_ADDRESS,
  L2_BASE_TOKEN_ADDRESS,
  L1_MESSENGER_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
  L1_SOPH_TOKEN_ADDRESS,
} from './constants';

export * as errors from './errors/factory';
export { formatEnvelopePretty } from './errors/formatter';

export * as zksRpc from './rpc/zks';
export type { ZksRpc } from './rpc/zks';
export { makeTransportFromEthers, makeTransportFromViem } from './rpc/transport';

export * from './utils/addr';

// Core resources (routes, events, logs)
export * from './resources/deposits/route';
export * from './resources/withdrawals/route';
export * from './resources/withdrawals/events';
export * from './resources/withdrawals/logs';

// Core types (type-only)
export type * from './types';
export type * from './types/errors';
export type * from './types/flows/base';
export type * from './types/flows/deposits';
export type * from './types/flows/withdrawals';
export type * from './types/flows/route';
export type * from './types/primitives';
