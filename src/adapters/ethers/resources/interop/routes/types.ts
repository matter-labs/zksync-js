// src/adapters/ethers/resources/deposits/routes/types.ts
import type { TransactionRequest } from 'ethers';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { InteropFeeBreakdown } from '../../../../../core/types/fees';
import type { RouteStrategy } from '../../../../../core/types/flows/route';
import type { BuildCtx } from '../context';

// An Interop route strategy for building an interop transaction request
export type InteropRouteStrategy = RouteStrategy<
  InteropParams,
  TransactionRequest,
  InteropFeeBreakdown,
  BuildCtx
>;
