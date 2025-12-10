import type { TransactionRequest } from 'ethers';
import { L2_BASE_TOKEN_ADDRESS } from '../../../../core/constants';
import type { Eip1559GasOverrides, PlanStep } from '../../../../core/types/flows/base';
import type { WithdrawRoute } from '../../../../core/types/flows/withdrawals';
import { toZKsyncError } from '../../errors/error-ops';
import type { BuildCtx } from './context';

type EstimateResult = {
  gasByStep: Record<string, bigint>;
  totalGasLimit: bigint;
  suggestedL2GasLimit: bigint;
};

function isNativeToken(to?: string | null): boolean {
  if (!to || typeof to !== 'string') return false;
  return to.toLowerCase() === L2_BASE_TOKEN_ADDRESS.toLowerCase();
}

function prepareTxForSimulation(
  tx: TransactionRequest,
  ctx: BuildCtx
): TransactionRequest {
  const simulationTx = { ...tx, from: tx.from ?? ctx.sender };

  if (isNativeToken(simulationTx.to as string)) {
    simulationTx.value = 0n;
  }
  return simulationTx;
}

function applyOverridesToLastStep(
  steps: Array<PlanStep<TransactionRequest>>,
  overrides?: Eip1559GasOverrides,
) {
  if (!overrides || steps.length === 0) return;
  const { gasLimit, maxFeePerGas, maxPriorityFeePerGas } = overrides;
  if (!gasLimit && !maxFeePerGas && !maxPriorityFeePerGas) return;

  const last = steps[steps.length - 1];
  
  if (gasLimit != null) last.tx.gasLimit = gasLimit;
  if (maxFeePerGas != null) last.tx.maxFeePerGas = maxFeePerGas;
  if (maxPriorityFeePerGas != null) last.tx.maxPriorityFeePerGas = maxPriorityFeePerGas;
}

export async function populateWithdrawalGas(
  steps: Array<PlanStep<TransactionRequest>>,
  ctx: BuildCtx & { route: WithdrawRoute },
  overrides?: Eip1559GasOverrides,
): Promise<EstimateResult> {
  applyOverridesToLastStep(steps, overrides);

  const estimatedSteps = await Promise.all(
    steps.map(async (step) => {
      if (step.tx.gasLimit != null) {
        return { 
          key: step.key, 
          limit: BigInt(step.tx.gasLimit) 
        };
      }

      try {
        const txForSim = prepareTxForSimulation(step.tx, ctx);
        const est = await ctx.client.l2.estimateGas(txForSim);
        
        const buffered = (BigInt(est) * BigInt(100 + ctx.gasBufferPct)) / 100n;
        
        step.tx.gasLimit = buffered;
        
        return { key: step.key, limit: buffered };
      } catch (e) {
        throw toZKsyncError(
          'RPC',
          {
            resource: 'withdrawals',
            operation: 'withdrawals.gas.estimate',
            message: 'Failed to estimate L2 gas for withdrawal transaction.',
            context: { step: step.key, to: step.tx.to, route: ctx.route },
          },
          e,
        );
      }
    })
  );

  const gasByStep: Record<string, bigint> = {};
  let calculatedSum = 0n;

  for (const item of estimatedSteps) {
    gasByStep[item.key] = item.limit;
    calculatedSum += item.limit;
  }

  const resolvedTotal = ctx.fee.gasLimit != null ? BigInt(ctx.fee.gasLimit) : calculatedSum;
  const suggestedL2GasLimit = resolvedTotal > 0n ? resolvedTotal : ctx.l2GasLimit;

  return { gasByStep, totalGasLimit: resolvedTotal, suggestedL2GasLimit };
}