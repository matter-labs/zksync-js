// src/adapters/ethers/resources/withdrawals/services/gas.ts

import type { TransactionRequest } from 'ethers';
import type { BuildCtx } from '../context';
import { BUFFER } from '../../../../../core/constants';

import { createErrorHandlers } from '../../../errors/error-ops';

const { wrapAs } = createErrorHandlers('withdrawals');

export type GasQuote = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxCost: bigint; // gasLimit * maxFeePerGas
};

export type QuoteWithdrawL2GasInput = {
  ctx: BuildCtx;
  tx: TransactionRequest;
};

async function fetchL2FeeData(ctx: BuildCtx): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  const fd = await ctx.client.l2.getFeeData();

  const maxFeePerGas =
    fd.maxFeePerGas != null
      ? BigInt(fd.maxFeePerGas)
      : fd.gasPrice != null
        ? BigInt(fd.gasPrice)
        : 0n;

  const maxPriorityFeePerGas =
    fd.maxPriorityFeePerGas != null ? BigInt(fd.maxPriorityFeePerGas) : 0n;

  return { maxFeePerGas, maxPriorityFeePerGas };
}

function makeGasQuote(p: {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}): GasQuote {
  return {
    gasLimit: p.gasLimit,
    maxFeePerGas: p.maxFeePerGas,
    maxPriorityFeePerGas: p.maxPriorityFeePerGas,
    maxCost: p.gasLimit * p.maxFeePerGas,
  };
}

/**
 * Quotes L2 gas for a withdrawal tx.
 * Respects ctx.gasOverrides and optional overrideGasLimit.
 */
/**
 * Quotes L2 gas for a withdrawal tx.
 * Respects ctx.gasOverrides and optional overrideGasLimit.
 */
export async function quoteL2Gas(input: QuoteWithdrawL2GasInput): Promise<GasQuote | undefined> {
  const { ctx, tx } = input;

  const market = await fetchL2FeeData(ctx);
  const o = ctx.gasOverrides;

  // 1) Fee pricing: overrides > tx > market
  const maxFeePerGas =
    o?.maxFeePerGas ?? (tx.maxFeePerGas != null ? BigInt(tx.maxFeePerGas) : market.maxFeePerGas);

  const maxPriorityFeePerGas =
    o?.maxPriorityFeePerGas ??
    (tx.maxPriorityFeePerGas != null
      ? BigInt(tx.maxPriorityFeePerGas)
      : market.maxPriorityFeePerGas);

  // 2) Gas limit: overrides.gasLimit > tx.gasLimit > estimate
  const explicitGasLimit = o?.gasLimit ?? (tx.gasLimit != null ? BigInt(tx.gasLimit) : undefined);

  if (explicitGasLimit != null) {
    return makeGasQuote({
      gasLimit: explicitGasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  }

  try {
    const est = await wrapAs(
      'RPC',
      'withdrawals.gas.l2.estimate',
      () => ctx.client.l2.estimateGas(tx),
      { ctx: { where: 'l2.estimateGas', to: tx.to } },
    );

    const buffered = (BigInt(est) * (100n + BUFFER)) / 100n;

    return makeGasQuote({
      gasLimit: buffered,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  } catch (err) {
    // TODO: add fallback value?
    console.warn('Failed to estimate L2 gas for withdrawal.', err);
    return undefined;
  }
}
