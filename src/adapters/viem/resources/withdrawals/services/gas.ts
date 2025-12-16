// src/adapters/viem/resources/withdrawals/services/gas.ts

import type { TransactionRequest } from 'viem';
import type { BuildCtx } from '../context';
import {
  quoteL2Gas as coreQuoteL2Gas,
  type GasQuote,
} from '../../../../../core/resources/withdrawals/gas';
import { viemToGasEstimator, toCoreTx } from '../../../../viem/estimator';

export type { GasQuote };

export type QuoteWithdrawL2GasInput = {
  ctx: BuildCtx;
  tx: TransactionRequest;
};

/**
 * Quotes L2 gas for a withdrawal tx.
 */
export async function quoteL2Gas(input: QuoteWithdrawL2GasInput): Promise<GasQuote | undefined> {
  const { ctx, tx } = input;
  const estimator = viemToGasEstimator(ctx.client.l2);

  return coreQuoteL2Gas({
    estimator,
    tx: toCoreTx(tx),
    overrides: ctx.gasOverrides,
  });
}
