// src/core/index.ts
export {
  ETH_ADDRESS,
  FORMAL_ETH_ADDRESS,
  L2_BASE_TOKEN_ADDRESS,
  L1_MESSENGER_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
  L1_SOPH_TOKEN_ADDRESS,
  L2_INTEROP_ATTRIBUTE_PARSER_ADDRESS,
  L2_INTEROP_CENTER_ADDRESS,
  L2_INTEROP_HANDLER_ADDRESS,
  L2_INTEROP_ROOT_STORAGE_ADDRESS,
  L2_BRIDGEHUB_ADDRESS,
  L2_INTEROP_COMMITMENT_TREE_ADDRESS,
  L2_ATOMIC_FLOW_MANAGER_ADDRESS,
  ATOMIC_FLOW_PREIMAGE_VERSION,
  ATOMIC_COMMIT_LEAF_TAG,
  MAX_ATOMIC_FLOW_LEGS,
  ATOMIC_LEG_STATE,
  INTEROP_BUNDLE_STATUS,
  INTEROP_BUNDLE_VERSION,
  INTEROP_CALL_VERSION,
  SUPPORTED_PROOF_METADATA_VERSION,
} from './constants';

export * as abi from './abi';

export * as errors from './errors/factory';
export { formatEnvelopePretty } from './errors/formatter';

export * as zksRpc from './rpc/zks';
export type { ZksRpc } from './rpc/zks';
export { makeTransportFromEthers, makeTransportFromViem } from './rpc/transport';

export * from './utils/addr';
export * from './utils/hash';

// Core resources (routes, events, logs)
export * from './resources/deposits/route';
export * from './resources/withdrawals/route';
export * from './resources/withdrawals/protocol';
export * from './resources/withdrawals/status';
export * from './resources/withdrawals/bundle';
export * from './resources/withdrawals/finalization';
export * from './resources/protocol/semver';
export * from './utils/events';
export * from './resources/withdrawals/logs';
export * from './resources/interop/atomic';

// Core types (type-only)
export type * from './types';
export type * from './types/errors';
export type * from './types/flows/base';
export type * from './types/flows/deposits';
export type * from './types/flows/withdrawals';
export type * from './types/flows/route';
export type * from './types/flows/token';
export type * from './types/flows/atomic-interop';
export type * from './types/primitives';
