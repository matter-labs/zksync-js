// src/adapters/ethers/resources/interop/services/gas.ts
//
// Best-effort L2 gas cost estimation across all steps in an interop plan.

import type { TransactionRequest } from 'ethers';
import { BUFFER } from '../../../../../core/constants';
import { ethersToGasEstimator, toCoreTx } from '../../../estimator';
import type { BuildCtx } from '../context';

/**
 * Estimates the combined L2 gas cost for all steps in an interop plan.
 *
 * Fetches gas price once, then estimates gas for each step using ctx.sender as the
 * from address. Applies the standard buffer and sums gasLimit × maxFeePerGas across
 * all steps. Returns undefined if estimation fails for any step.
 */
export async function quoteStepsL2Fee(
  steps: Array<{ tx: TransactionRequest }>,
  ctx: BuildCtx,
): Promise<bigint | undefined> {
  if (steps.length === 0) return 0n;

  const estimator = ethersToGasEstimator(ctx.client.l2);

  let maxFeePerGas: bigint;
  try {
    const fees = await estimator.estimateFeesPerGas();
    maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice ?? (await estimator.getGasPrice());
  } catch {
    return undefined;
  }

  let total = 0n;
  for (const step of steps) {
    try {
      const coreTx = toCoreTx({ ...step.tx, from: ctx.sender });
      const est = await estimator.estimateGas(coreTx);
      const buffered = (BigInt(est) * (100n + BUFFER)) / 100n;
      total += buffered * maxFeePerGas;
    } catch {
      return undefined;
    }
  }

  return total;
}
