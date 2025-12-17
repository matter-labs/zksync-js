import type { WalletClient, Transport, Chain, Account } from 'viem';
import type { DepositParams } from '../../../../../core/types/flows/deposits';
import type { RouteStrategy } from '../../../../../core/types/flows/route';
import type { BuildCtx as DepositBuildCtx } from '../context';
import type { DepositFeeBreakdown } from '../../../../../core/types/fees';

// Base type from viem:
type WriteParams = Parameters<WalletClient<Transport, Chain, Account>['writeContract']>[0];

/**
 * viem specific
 * Plan-time write request: relax 'value' so a single type can hold both
 * non-payable (no value) and payable (value: bigint) requests.
 */
export type ViemPlanWriteRequest = Omit<WriteParams, 'value'> & { value?: bigint };

// Route strategy
export type DepositRouteStrategy = RouteStrategy<
  DepositParams,
  ViemPlanWriteRequest,
  DepositFeeBreakdown,
  DepositBuildCtx
>;
