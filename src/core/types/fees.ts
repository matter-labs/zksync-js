// src/core/types/fees.ts

import type { Address } from './primitives';

// Minimal public gas parameters shared across adapters
export type L1DepositFeeParams = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  maxTotal: bigint;
};

export type L2DepositFeeParams = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  total: bigint;
  baseCost: bigint;
  gasPerPubdata: bigint;
  operatorTip?: bigint;
};

export type L2WithdrawalFeeParams = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  total: bigint;
};

// Minimal public fee breakdown shared across adapters
export type DepositFeeBreakdown = {
  token: Address; // fee token address
  maxTotal: bigint; // max amount that can be charged
  mintValue?: bigint;
  l1?: L1DepositFeeParams;
  l2?: L2DepositFeeParams;
};

// Minimal public fee breakdown shared across adapters
export type WithdrawalFeeBreakdown = {
  token: Address; // fee token address
  maxTotal: bigint; // max amount that can be charged
  mintValue?: bigint;
  l2?: L2WithdrawalFeeParams;
};

// transaction gas overrides
export type TxOverrides = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
};
