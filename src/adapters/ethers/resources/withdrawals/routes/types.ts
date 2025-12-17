// src/adapters/ethers/resources/withdrawals/routes/types.ts
import type { TransactionRequest, TransactionReceipt } from 'ethers';
import type { WithdrawParams } from '../../../../../core/types/flows/withdrawals';
import type { RouteStrategy } from '../../../../../core/types/flows/route';
import type { BuildCtx as WithdrawBuildCtx } from '../context';
import type { Address, Hex } from '../../../../../core/types';
import type { WithdrawalFeeBreakdown } from '../../../../../core/types/fees';

export type WithdrawRouteStrategy = RouteStrategy<
  WithdrawParams,
  TransactionRequest,
  WithdrawalFeeBreakdown,
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

// Ethers receipt extended with L2→L1 logs
export type TransactionReceiptZKsyncOS = TransactionReceipt & {
  l2ToL1Logs?: L2ToL1Log[];
};
