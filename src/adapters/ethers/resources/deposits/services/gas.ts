import type { TransactionRequest } from 'ethers';
import type { BuildCtx } from '../context';
import type { DepositRoute } from '../../../../../core/types/flows/deposits';
import type { GasParams } from '../../../../../core/types/fees';
import {
  BUFFER,
  DEFAULT_PUBDATA_BYTES,
  TX_MEMORY_OVERHEAD_GAS,
  TX_OVERHEAD_GAS,
  DEFAULT_ABI_BYTES,
} from '../../../../../core/constants';
import { createErrorHandlers } from '../../../errors/error-ops';

const { wrapAs } = createErrorHandlers('deposits');

// --- Types ---

export interface ResolvedGas {
  params: GasParams;
}

export interface DepositGasResult {
  l1?: ResolvedGas;
  l2?: ResolvedGas;
}

export interface DepositGasOverrides {
  l1GasLimit?: bigint;
  l2GasLimit?: bigint;
}

export interface DepositGasInput {
  ctx: BuildCtx;
  route: DepositRoute;
  l1Tx: TransactionRequest;
  l2TxForModeling?: TransactionRequest;
  overrides?: DepositGasOverrides;
}

export interface EstimateL1GasOptions {
  ctx: BuildCtx;
  tx: TransactionRequest;
  overrideGasLimit?: bigint;
}

export interface EstimateL2GasOptions {
  ctx: BuildCtx;
  route: DepositRoute;
  l2TxForModeling?: TransactionRequest;
  overrideGasLimit?: bigint;
}

export interface DepositGasServices {
  estimateForDeposit(input: DepositGasInput): Promise<DepositGasResult>;
  estimateL1Gas(options: EstimateL1GasOptions): Promise<ResolvedGas | undefined>;
  estimateL2Gas(options: EstimateL2GasOptions): Promise<ResolvedGas | undefined>;
}

// --- Helpers ---

const buildGasParams = (
  gasLimit: bigint,
  maxFeePerGas: bigint,
  maxPriorityFeePerGas?: bigint,
  gasPerPubdata?: bigint,
): GasParams => ({
  gasLimit,
  maxFeePerGas,
  maxPriorityFeePerGas,
  maxGasCost: gasLimit * maxFeePerGas,
  gasPerPubdata,
});

const createL1GasResult = (
  gasLimit: bigint,
  feePerGas: bigint,
  maxPriorityFeePerGas?: bigint,
): ResolvedGas => ({
  params: buildGasParams(gasLimit, feePerGas, maxPriorityFeePerGas),
});

const createL2GasResult = (
  gasLimit: bigint,
  feePerGas: bigint,
  gasPerPubdata: bigint,
): ResolvedGas => ({
  params: buildGasParams(gasLimit, feePerGas, 0n, gasPerPubdata),
});

// Legacy support for older providers/EraVM
const fetchL2BaseFee = async (ctx: BuildCtx): Promise<bigint | undefined> => {
  try {
    const fd = await ctx.client.l2.getFeeData();
    if (fd.maxFeePerGas) return fd.maxFeePerGas;
    if (fd.gasPrice) return fd.gasPrice;

    const legacyClient = ctx.client.l2 as { getGasPrice?: () => Promise<bigint> };
    if (typeof legacyClient.getGasPrice === 'function') {
      return await legacyClient.getGasPrice();
    }
  } catch {
    return undefined;
  }
  return undefined;
};

// --- Internal implementations ---

const estimateL1GasInternal = async (
  options: EstimateL1GasOptions,
): Promise<ResolvedGas | undefined> => {
  const { ctx, tx, overrideGasLimit } = options;
  const { maxFeePerGas, maxPriorityFeePerGas } = ctx.fee;

  // 1. Explicit override
  if (overrideGasLimit != null) {
    return createL1GasResult(overrideGasLimit, maxFeePerGas, maxPriorityFeePerGas);
  }

  // 2. RPC estimation
  try {
    const est = await wrapAs(
      'RPC',
      'deposits.gas.l1.estimate',
      () => ctx.client.l1.estimateGas(tx),
      { ctx: { where: 'l1.estimateGas', to: tx.to } },
    );

    const paddedLimit = (BigInt(est) * (100n + BUFFER)) / 100n;

    return createL1GasResult(paddedLimit, maxFeePerGas, maxPriorityFeePerGas);
  } catch (err) {
    console.warn('L1 gas estimation failed', err);
    return undefined;
  }
};

const estimateL2GasInternal = async (
  options: EstimateL2GasOptions,
): Promise<ResolvedGas | undefined> => {
  const { ctx, l2TxForModeling, overrideGasLimit } = options;

  const baseFee = await fetchL2BaseFee(ctx);
  if (baseFee == null) {
    return undefined;
  }

  const gasPerPubdata = ctx.gasPerPubdata;

  // 1. Determine if we have an override (explicit, or implied by the input tx)
  const txGasLimit =
    l2TxForModeling?.gasLimit != null ? BigInt(l2TxForModeling.gasLimit) : undefined;
  const effectiveOverride = overrideGasLimit ?? txGasLimit;

  if (effectiveOverride != null) {
    return createL2GasResult(effectiveOverride, baseFee, gasPerPubdata);
  }

  // 2. No tx to model -> Default fallback
  if (!l2TxForModeling) {
    return createL2GasResult(ctx.l2GasLimit, baseFee, gasPerPubdata);
  }

  // 3. RPC estimation + overhead calculation
  try {
    const execEstimate = await wrapAs(
      'RPC',
      'deposits.gas.l2.estimate',
      () => ctx.client.l2.estimateGas(l2TxForModeling),
      { ctx: { where: 'l2.estimateGas', to: l2TxForModeling.to } },
    );

    const memoryOverhead = DEFAULT_ABI_BYTES * TX_MEMORY_OVERHEAD_GAS;
    const pubdataOverhead = DEFAULT_PUBDATA_BYTES * gasPerPubdata;

    let calculatedLimit =
      BigInt(execEstimate) + TX_OVERHEAD_GAS + memoryOverhead + pubdataOverhead;
    calculatedLimit = (calculatedLimit * (100n + BUFFER)) / 100n;

    return createL2GasResult(calculatedLimit, baseFee, gasPerPubdata);
  } catch (err) {
    console.warn('L2 gas estimation failed, using default fallback', err);
    
    // 4. Fallback on Estimation Failure
    return createL2GasResult(ctx.l2GasLimit, baseFee, gasPerPubdata);
  }
};

// --- Public services ---

export const depositGasServices: DepositGasServices = {
  async estimateForDeposit(input) {
    const { ctx, route, l1Tx, l2TxForModeling, overrides } = input;
    const overridesSafe = overrides ?? {};

    // Run L1 and L2 estimations in parallel
    const [l1, l2] = await Promise.all([
      estimateL1GasInternal({
        ctx,
        tx: l1Tx,
        overrideGasLimit: overridesSafe.l1GasLimit,
      }),
      estimateL2GasInternal({
        ctx,
        route,
        l2TxForModeling,
        overrideGasLimit: overridesSafe.l2GasLimit,
      }),
    ]);

    return { l1, l2 };
  },

  estimateL1Gas(options) {
    return estimateL1GasInternal(options);
  },

  estimateL2Gas(options) {
    return estimateL2GasInternal(options);
  },
};
