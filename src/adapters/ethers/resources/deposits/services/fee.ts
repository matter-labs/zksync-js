// src/adapters/ethers/resources/deposits/services/fee.ts

import { Interface, type InterfaceAbi } from 'ethers';
import type { BuildCtx } from '../context';
import {
  quoteL2BaseCost as coreQuoteL2BaseCost,
  type AbiEncoder,
} from '../../../../../core/resources/deposits/gas';
import { ethersToGasEstimator } from '../../../../ethers/estimator';
import { createErrorHandlers } from '../../../errors/error-ops';

const { wrapAs } = createErrorHandlers('deposits');

export type QuoteL2BaseCostInput = {
  ctx: BuildCtx;
  l2GasLimit: bigint;
};

const encode: AbiEncoder = (abi, fn, args) => {
  return new Interface(abi as InterfaceAbi).encodeFunctionData(fn, args);
};

// Quotes the L2 base cost for a deposit transaction.
// Calls `l2TransactionBaseCost` on Bridgehub contract.
export async function quoteL2BaseCost(input: QuoteL2BaseCostInput): Promise<bigint> {
  const { ctx, l2GasLimit } = input;
  const estimator = ethersToGasEstimator(ctx.client.l1);

  return wrapAs(
    'RPC',
    'deposits.fees.l2BaseCost',
    () =>
      coreQuoteL2BaseCost({
        estimator,
        encode,
        bridgehub: ctx.bridgehub,
        chainIdL2: ctx.chainIdL2,
        l2GasLimit,
        gasPerPubdata: ctx.gasPerPubdata,
      }),
    { ctx: { chainIdL2: ctx.chainIdL2 } },
  );
}
