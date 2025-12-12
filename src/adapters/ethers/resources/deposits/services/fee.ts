// src/adapters/ethers/resources/deposits/services/fees.ts

import { Contract } from 'ethers';
import type { BuildCtx } from '../context';
import { IBridgehubABI } from '../../../../../core/abi';
import type { Address } from '../../../../../core/types/primitives';
import type {
  DepositFeeBreakdown,
  L1DepositFeeParams,
  L2DepositFeeParams,
} from '../../../../../core/types/fees';
import { createErrorHandlers } from '../../../errors/error-ops';
import type { GasQuote } from './gas';

const { wrapAs } = createErrorHandlers('deposits');

export type QuoteL2BaseCostInput = {
  ctx: BuildCtx;
  l2GasLimit: bigint;
};

/**
 * Fetch L1 gas price (EIP-1559 preferred, legacy supported) used by Bridgehub base cost calculation.
 */
async function fetchL1GasPriceForBaseCost(ctx: BuildCtx): Promise<bigint> {
  const fd = await ctx.client.l1.getFeeData();
  if (fd.maxFeePerGas != null) return BigInt(fd.maxFeePerGas);
  if (fd.gasPrice != null) return BigInt(fd.gasPrice);

  const legacyClient = ctx.client.l1 as { getGasPrice?: () => Promise<bigint> };
  if (typeof legacyClient.getGasPrice === 'function') {
    return await legacyClient.getGasPrice();
  }

  throw new Error('Could not fetch L1 gas price for Bridgehub base cost calculation.');
}

/**
 * Quotes the L2 base cost for an L1->L2 transaction using Bridgehub.
 *
 */
export async function quoteL2BaseCost(input: QuoteL2BaseCostInput): Promise<bigint> {
  const { ctx, l2GasLimit } = input;

  const bridgehub = new Contract(ctx.bridgehub, IBridgehubABI, ctx.client.l1);
  const l1GasPrice = await fetchL1GasPriceForBaseCost(ctx);

  const raw = (await wrapAs(
    'RPC',
    'deposits.fees.l2BaseCost',
    () => bridgehub.l2TransactionBaseCost(ctx.chainIdL2, l1GasPrice, l2GasLimit, ctx.gasPerPubdata),
    { ctx: { chainIdL2: ctx.chainIdL2 } },
  )) as bigint;

  return BigInt(raw);
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
