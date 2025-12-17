// src/core/resources/deposits/fee.ts

import type { Address } from '../../types/primitives';
import type { DepositFeeBreakdown, L1DepositFeeParams, L2DepositFeeParams } from '../../types/fees';
import type { GasQuote } from './gas';

export type BuildFeeBreakdownInput = {
  feeToken: Address;
  l1Gas?: GasQuote;
  l2Gas?: GasQuote;
  l2BaseCost: bigint;
  operatorTip: bigint;
  mintValue: bigint;
};

/**
 * Builds the public FeeBreakdown shape from already-computed components.
 */
export function buildFeeBreakdown(p: BuildFeeBreakdownInput): DepositFeeBreakdown {
  const l1MaxTotal = p.l1Gas?.maxCost ?? 0n;

  const l2Total = p.l2BaseCost + p.operatorTip;

  const l1: L1DepositFeeParams = {
    gasLimit: p.l1Gas?.gasLimit ?? 0n,
    maxFeePerGas: p.l1Gas?.maxFeePerGas ?? 0n,
    maxPriorityFeePerGas: p.l1Gas?.maxPriorityFeePerGas,
    maxTotal: l1MaxTotal,
  };

  const l2: L2DepositFeeParams = {
    total: l2Total,
    baseCost: p.l2BaseCost,
    operatorTip: p.operatorTip,
    gasLimit: p.l2Gas?.gasLimit ?? 0n,
    maxFeePerGas: p.l2Gas?.maxFeePerGas ?? 0n,
    maxPriorityFeePerGas: p.l2Gas?.maxPriorityFeePerGas,
    gasPerPubdata: p.l2Gas?.gasPerPubdata ?? 0n,
  };

  return {
    token: p.feeToken,
    maxTotal: l1MaxTotal + l2Total,
    mintValue: p.mintValue,
    l1,
    l2,
  };
}
