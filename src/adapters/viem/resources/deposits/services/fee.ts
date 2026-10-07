// src/adapters/viem/resources/deposits/services/fee.ts

import type { BuildCtx } from '../context';
import { createErrorHandlers } from '../../../errors/error-ops';
import { IBridgehubABI } from '../../../../../core/abi';

const { wrapAs } = createErrorHandlers('deposits');

export type QuoteL2BaseCostInput = {
  ctx: BuildCtx;
  l2GasLimit: bigint;
  // maxFeePerGas the L1 tx is sent with, see quoteL1Fees
  l1GasPrice: bigint;
};

// Quotes the L2 base cost for a deposit transaction.
// Calls `l2TransactionBaseCost` on Bridgehub contract.
// For Viem adapter - we still rely on readContract
export async function quoteL2BaseCost(input: QuoteL2BaseCostInput): Promise<bigint> {
  const { ctx, l2GasLimit, l1GasPrice } = input;

  return wrapAs(
    'RPC',
    'deposits.fees.l2BaseCost',
    async () => {
      return await ctx.client.l1.readContract({
        address: ctx.bridgehub,
        abi: IBridgehubABI,
        functionName: 'l2TransactionBaseCost',
        args: [ctx.chainIdL2, l1GasPrice, l2GasLimit, ctx.gasPerPubdata],
      });
    },
    { ctx: { chainIdL2: ctx.chainIdL2 } },
  );
}
