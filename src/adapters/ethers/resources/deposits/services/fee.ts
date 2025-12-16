// src/adapters/ethers/resources/deposits/services/fee.ts

import { Interface } from 'ethers';
import type { BuildCtx } from '../context';
import type { Address } from '../../../../../core/types/primitives';
import type {
  DepositFeeBreakdown,
  L1DepositFeeParams,
  L2DepositFeeParams,
} from '../../../../../core/types/fees';
import type { GasQuote } from './gas';
import { quoteL2BaseCost as coreQuoteL2BaseCost, type AbiEncoder } from '../../../../../core/resources/deposits/gas';
import { ethersToGasEstimator } from '../../../../ethers/estimator';
import { createErrorHandlers } from '../../../errors/error-ops';

const { wrapAs } = createErrorHandlers('deposits');

export type QuoteL2BaseCostInput = {
  ctx: BuildCtx;
  l2GasLimit: bigint;
};

const encode: AbiEncoder = (abi, fn, args) => {
  return new Interface(abi).encodeFunctionData(fn, args);
};

export async function quoteL2BaseCost(input: QuoteL2BaseCostInput): Promise<bigint> {
  const { ctx, l2GasLimit } = input;
  const estimator = ethersToGasEstimator(ctx.client.l1);

  return wrapAs('RPC', 'deposits.fees.l2BaseCost', () =>
    coreQuoteL2BaseCost({
      estimator,
      encode,
      bridgehub: ctx.bridgehub,
      chainIdL2: ctx.chainIdL2,
      l2GasLimit,
      gasPerPubdata: ctx.gasPerPubdata
    }),
    { ctx: { chainIdL2: ctx.chainIdL2 } }
  );
}

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
