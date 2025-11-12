// src/adapters/viem/resources/withdrawals/routes/types.ts

import type { WalletClient, Transport, Chain, Account, TransactionReceipt } from 'viem';
import type { WithdrawParams } from '../../../../../core/types/flows/withdrawals';
import type { RouteStrategy } from '../../../../../core/types/flows/route';
import type { BuildCtx as WithdrawBuildCtx } from '../context';
import type { Address, Hex } from '../../../../../core/types';

// viem writeContract() parameter type
export type ViemPlanWriteRequest = Parameters<
  WalletClient<Transport, Chain, Account>['writeContract']
>[0];

export type WithdrawQuoteExtras = Record<string, never>;

export type WithdrawRouteStrategy = RouteStrategy<
  WithdrawParams,
  ViemPlanWriteRequest,
  WithdrawQuoteExtras,
  WithdrawBuildCtx
>;

// L2→L1 service log
export interface L2ToL1Log {
  l2ShardId?: number;
  isService?: boolean;
  txNumberInBlock?: number;
  sender?: Address;
  key?: Hex;
  value?: Hex;
}

// viem receipt extended with L2→L1 logs
// TODO: this is what getTransactionReceipt should return
export type TransactionReceiptZKsyncOS = TransactionReceipt & {
  l2ToL1Logs?: L2ToL1Log[];
};
