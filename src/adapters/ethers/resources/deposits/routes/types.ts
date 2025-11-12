// src/adapters/ethers/resources/deposits/routes/types.ts
import type { TransactionRequest } from 'ethers';
import type { DepositParams } from '../../../../../core/types/flows/deposits';
import type { RouteStrategy } from '../../../../../core/types/flows/route';
import type { BuildCtx as DepositBuildCtx } from '../context';

// Extra data returned from quote step, passed to build step
export type DepositQuoteExtras = {
  baseCost: bigint;
  mintValue: bigint;
  l1GasLimit?: bigint;
};

// A Deposit route strategy for building a deposit transaction request
export type DepositRouteStrategy = RouteStrategy<
  DepositParams,
  TransactionRequest,
  DepositQuoteExtras,
  DepositBuildCtx
>;
