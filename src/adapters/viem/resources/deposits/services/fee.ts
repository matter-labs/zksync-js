// src/adapters/viem/resources/deposits/services/fee.ts

import type { BuildCtx } from '../context';
import { viemToGasEstimator } from '../../../../viem/estimator';
import { createErrorHandlers } from '../../../errors/error-ops';
import { IBridgehubABI } from '../../../../../core/abi';

const { wrapAs } = createErrorHandlers('deposits');

export type QuoteL2BaseCostInput = {
  ctx: BuildCtx;
  l2GasLimit: bigint;
};

// Quotes the L2 base cost for a deposit transaction.
// Calls `l2TransactionBaseCost` on Bridgehub contract.
// For Viem adapter - we still rely on readContract
export async function quoteL2BaseCost(input: QuoteL2BaseCostInput): Promise<bigint> {
  const { ctx, l2GasLimit } = input;
  const estimator = viemToGasEstimator(ctx.client.l1);

  // fetch gas price done in core estimator
  const fees = await estimator.estimateFeesPerGas();
  const gasPrice = fees.maxFeePerGas ?? fees.gasPrice ?? (await estimator.getGasPrice());

  return wrapAs(
    'RPC',
    'deposits.fees.l2BaseCost',
    async () => {
      return await ctx.client.l1.readContract({
        address: ctx.bridgehub,
        abi: IBridgehubABI,
        functionName: 'l2TransactionBaseCost',
        args: [ctx.chainIdL2, gasPrice, l2GasLimit, ctx.gasPerPubdata],
      });
    },
    { ctx: { chainIdL2: ctx.chainIdL2 } },
  );
}
