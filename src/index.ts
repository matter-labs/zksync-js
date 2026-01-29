// index.ts

export * as constants from './core/constants';

export * as abi from './core/abi';

export * as errors from './core/errors/factory';
export { formatEnvelopePretty } from './core/errors/formatter';

export * as zksRpc from './core/rpc/zks';
export type { ZksRpc } from './core/rpc/zks';
export { makeTransportFromEthers, makeTransportFromViem } from './core/rpc/transport';

export * from './core/utils/addr';
export * from './core/resources/interop/attributes';

// Core resources (routes, events, logs)
export * from './core/resources/deposits/route';
export * from './core/resources/withdrawals/route';
export * from './core/resources/withdrawals/events';
export * from './core/resources/withdrawals/logs';

// Core types (type-only so we don't emit)
export type * from './core/types';
export type * from './core/types/errors';
export type * from './core/types/flows/base';
export type * from './core/types/flows/deposits';
export type * from './core/types/flows/interop';
export type * from './core/types/flows/withdrawals';
export type * from './core/types/flows/route';
export type * from './core/types/flows/token';
export type * from './core/types/primitives';
