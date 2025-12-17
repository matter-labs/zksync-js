// src/adapters/ethers/resources/deposits/routes/types.ts
import type { TransactionRequest } from 'ethers';
import type { DepositParams } from '../../../../../core/types/flows/deposits';
import type { DepositFeeBreakdown } from '../../../../../core/types/fees';
import type { RouteStrategy } from '../../../../../core/types/flows/route';
import type { BuildCtx as DepositBuildCtx } from '../context';

// A Deposit route strategy for building a deposit transaction request
export type DepositRouteStrategy = RouteStrategy<
  DepositParams,
  TransactionRequest,
  DepositFeeBreakdown,
  DepositBuildCtx
>;
