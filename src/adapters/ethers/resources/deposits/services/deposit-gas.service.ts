import type { TransactionRequest } from 'ethers';
import type { BuildCtx } from '../context';
import type { DepositRoute } from '../../../../../core/types/flows/deposits';
import type { GasParams } from '../../../../../core/types/fees';
import {
  BUFFER,
  MAX_L2_GAS_ERC20,
  MAX_L2_GAS_ETH,
  MIN_L2_GAS_ERC20,
  MIN_L2_GAS_ETH,
  PUBDATA_BYTES_FOR_ERC20_BASE_DEPOSIT,
  PUBDATA_BYTES_FOR_ERC20_NONBASE_DEPOSIT,
  PUBDATA_BYTES_FOR_ETH_DEPOSIT,
  TX_MEMORY_OVERHEAD_GAS,
  TX_OVERHEAD_GAS,
} from '../../../../../core/constants';
import { createErrorHandlers } from '../../../errors/error-ops';

const { wrapAs } = createErrorHandlers('deposits');

export type GasSource = 'override' | 'estimated' | 'default';

export interface ResolvedGas<TExtra = unknown> {
  params: GasParams;
  source: GasSource;
  extra?: TExtra;
}

export interface DepositGasResult {
  l1?: ResolvedGas;
  l2?: ResolvedGas<{ route: DepositRoute }>;
}

export interface DepositGasOverrides {
  l1GasLimitOverridden: boolean; // user provided l1TxOverrides.gasLimit
  l2GasLimitOverridden: boolean; // user provided l2GasLimit
}

export interface DepositGasInput {
  ctx: BuildCtx;
  route: DepositRoute;
  l1Tx: TransactionRequest;
  l2TxForModeling?: TransactionRequest;
  overrides: DepositGasOverrides;
}

export interface DepositGasServices {
  estimateForDeposit(input: DepositGasInput): Promise<DepositGasResult>;
  estimateL1Gas(
    ctx: BuildCtx,
    tx: TransactionRequest,
    overrideGasLimit?: bigint,
  ): Promise<ResolvedGas | undefined>;
  estimateL2Gas(
    ctx: BuildCtx,
    route: DepositRoute,
    l2TxForModeling?: TransactionRequest,
    overrideGasLimit?: bigint,
  ): Promise<ResolvedGas<{ route: DepositRoute }> | undefined>;
}

export const depositGasServices: DepositGasServices = {
  async estimateForDeposit(input) {
    const { ctx, route, l1Tx, l2TxForModeling, overrides } = input;

    const l1 = await this.estimateL1Gas(
      ctx,
      l1Tx,
      overrides.l1GasLimitOverridden && l1Tx.gasLimit != null ? BigInt(l1Tx.gasLimit) : undefined,
    );

    const l2 = await this.estimateL2Gas(
      ctx,
      route,
      l2TxForModeling,
      overrides.l2GasLimitOverridden ? ctx.l2GasLimit : undefined,
    );

    return { l1, l2 };
  },

  async estimateL1Gas(ctx, tx, overrideGasLimit) {
    const maxFeePerGas = ctx.fee.maxFeePerGas;
    const maxPriorityFeePerGas = ctx.fee.maxPriorityFeePerGas;

    if (overrideGasLimit != null) {
      const gasLimit = overrideGasLimit;
      return {
        source: 'override',
        params: {
          gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas,
          maxGasCost: gasLimit * maxFeePerGas,
        },
      };
    }

    try {
      const est = await wrapAs(
        'RPC',
        'deposits.gas.l1.estimate',
        () => ctx.client.l1.estimateGas(tx),
        { ctx: { where: 'l1.estimateGas', to: tx.to } },
      );
      let gasLimit = BigInt(est);
      gasLimit = (gasLimit * (100n + BUFFER)) / 100n;

      return {
        source: 'estimated',
        params: {
          gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas,
          maxGasCost: gasLimit * maxFeePerGas,
        },
      };
    } catch {
      return undefined;
    }
  },

  async estimateL2Gas(ctx, route, l2TxForModeling, overrideGasLimit) {
    let baseFee: bigint;
    try {
      const fd = await ctx.client.l2.getFeeData();
      const gp = fd?.gasPrice ?? fd?.maxFeePerGas;
      if (gp != null) {
        baseFee = gp;
      } else {
        const gp2 = (ctx.client.l2 as { getGasPrice?: () => Promise<bigint> }).getGasPrice;
        if (!gp2) return undefined;
        baseFee = await gp2.call(ctx.client.l2);
      }
    } catch {
      return undefined;
    }

    if (overrideGasLimit != null) {
      const gasLimit = overrideGasLimit;
      return {
        source: 'override',
        extra: { route },
        params: {
          gasLimit,
          maxFeePerGas: baseFee,
          maxPriorityFeePerGas: 0n,
          maxGasCost: gasLimit * baseFee,
          gasPerPubdata: ctx.gasPerPubdata,
        },
      };
    }

    if (!l2TxForModeling) {
      const gasLimit = ctx.l2GasLimit;
      return {
        source: 'default',
        extra: { route },
        params: {
          gasLimit,
          maxFeePerGas: baseFee,
          maxPriorityFeePerGas: 0n,
          maxGasCost: gasLimit * baseFee,
          gasPerPubdata: ctx.gasPerPubdata,
        },
      };
    }

    try {
      const execEstimate = await wrapAs(
        'RPC',
        'deposits.gas.l2.estimate',
        () => ctx.client.l2.estimateGas(l2TxForModeling),
        { ctx: { where: 'l2.estimateGas', to: l2TxForModeling.to } },
      );

      const pubdataBytes =
        route === 'eth-base'
          ? PUBDATA_BYTES_FOR_ETH_DEPOSIT
          : route === 'erc20-base'
            ? PUBDATA_BYTES_FOR_ERC20_BASE_DEPOSIT
            : PUBDATA_BYTES_FOR_ERC20_NONBASE_DEPOSIT;

      const txAbiBytes = route === 'eth-base' ? 400n : route === 'erc20-base' ? 450n : 500n;

      const memoryOverhead = txAbiBytes * TX_MEMORY_OVERHEAD_GAS;
      const pubdataOverhead = pubdataBytes * ctx.gasPerPubdata;

      let gasLimit = BigInt(execEstimate) + TX_OVERHEAD_GAS + memoryOverhead + pubdataOverhead;
      gasLimit = (gasLimit * (100n + BUFFER)) / 100n;

      const [min, max] =
        route === 'eth-base'
          ? [MIN_L2_GAS_ETH, MAX_L2_GAS_ETH]
          : [MIN_L2_GAS_ERC20, MAX_L2_GAS_ERC20];

      if (gasLimit < min) gasLimit = min;
      if (gasLimit > max) gasLimit = max;

      return {
        source: 'estimated',
        extra: { route },
        params: {
          gasLimit,
          maxFeePerGas: baseFee,
          maxPriorityFeePerGas: 0n,
          maxGasCost: gasLimit * baseFee,
          gasPerPubdata: ctx.gasPerPubdata,
        },
      };
    } catch {
      const gasLimit = ctx.l2GasLimit;
      return {
        source: 'default',
        extra: { route },
        params: {
          gasLimit,
          maxFeePerGas: baseFee,
          maxPriorityFeePerGas: 0n,
          maxGasCost: gasLimit * baseFee,
          gasPerPubdata: ctx.gasPerPubdata,
        },
      };
    }
  },
};
