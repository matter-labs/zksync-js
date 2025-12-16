// src/adapters/ethers/resources/withdrawals/services/gas.ts

import type { TransactionRequest } from 'ethers';
import type { BuildCtx } from '../context';
import type { Address } from '../../../../../core/types/primitives';
import type { CoreTransactionRequest } from '../../../../../core/adapters/interfaces';
import { quoteL2Gas as coreQuoteL2Gas, type GasQuote } from '../../../../../core/resources/withdrawals/gas';
import { ethersToGasEstimator } from '../../../../ethers/estimator';

export type { GasQuote };

export type QuoteWithdrawL2GasInput = {
  ctx: BuildCtx;
  tx: TransactionRequest;
};

function toCoreTx(tx: TransactionRequest): CoreTransactionRequest {
  return {
    to: tx.to as Address,
    from: tx.from as Address,
    data: tx.data as string,
    value: tx.value ? BigInt(tx.value as any) : undefined,
    gasLimit: tx.gasLimit ? BigInt(tx.gasLimit as any) : undefined,
    maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas as any) : undefined,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas as any) : undefined,
  };
}

/**
 * Quotes L2 gas for a withdrawal tx.
 */
export async function quoteL2Gas(input: QuoteWithdrawL2GasInput): Promise<GasQuote | undefined> {
  const { ctx, tx } = input;
  const estimator = ethersToGasEstimator(ctx.client.l2);

  return coreQuoteL2Gas({
    estimator,
    tx: toCoreTx(tx),
    overrides: ctx.gasOverrides
  });
}
