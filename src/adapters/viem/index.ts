export { createViemClient as createClient } from './client';
export * from './client';
export * from './sdk';

export * from './resources/utils';
export { createDepositsResource } from './resources/deposits';
export type { DepositsResource } from './resources/deposits';
export { createWithdrawalsResource } from './resources/withdrawals';
export { createFinalizationServices } from './resources/withdrawals';
export type { WithdrawalsResource, FinalizationServices } from './resources/withdrawals';
export { createTokensResource } from './resources/tokens';
export { createContractsResource } from './resources/contracts';
export type { ContractsResource, ContractInstances } from './resources/contracts';
export { createInteropResource } from './resources/interop';
export { createViemAttributesResource } from './resources/interop/attributes';
export type { InteropResource } from './resources/interop';

export * from './errors/error-ops';
export * from './errors/revert';
