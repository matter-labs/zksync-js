// src/adapters/viem/resources/withdrawals/services/gas.ts

import type { TransactionRequest } from 'viem';
import type { BuildCtx } from '../context';
import type { Address } from '../../../../../core/types/primitives';
import type { CoreTransactionRequest } from '../../../../../core/adapters/interfaces';
import { quoteL2Gas as coreQuoteL2Gas, type GasQuote } from '../../../../../core/resources/withdrawals/gas';
import { viemToGasEstimator } from '../../../../viem/estimator';

export type { GasQuote };

export type QuoteWithdrawL2GasInput = {
  ctx: BuildCtx;
  tx: TransactionRequest;
};

function toCoreTx(tx: TransactionRequest): CoreTransactionRequest {
  const raw = tx as any;
  let from: Address | undefined;
  if (typeof raw.account === 'string') {
    from = raw.account as Address;
  } else if (raw.account && typeof raw.account === 'object' && 'address' in raw.account) {
    from = raw.account.address as Address;
  } else if (raw.from) {
    from = raw.from as Address;
  }

  return {
    to: tx.to as Address,
    from,
    data: tx.data as string,
    value: tx.value,
    gasLimit: tx.gas,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
  };
}

/**
 * Quotes L2 gas for a withdrawal tx.
 */
export async function quoteL2Gas(input: QuoteWithdrawL2GasInput): Promise<GasQuote | undefined> {
  const { ctx, tx } = input;
  const estimator = viemToGasEstimator(ctx.client.l2);

  return coreQuoteL2Gas({
    estimator,
    tx: toCoreTx(tx),
    overrides: ctx.gasOverrides
  });
}
