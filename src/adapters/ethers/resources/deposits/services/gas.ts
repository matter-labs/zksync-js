// src/adapters/ethers/resources/deposits/services/gas.ts

import type { TransactionRequest } from 'ethers';
import type { BuildCtx } from '../context';
import type { DepositRoute } from '../../../../../core/types/flows/deposits';
import type { TxOverrides } from '../../../../../core/types/fees';

import {
  BUFFER,
  DEFAULT_PUBDATA_BYTES,
  TX_MEMORY_OVERHEAD_GAS,
  TX_OVERHEAD_GAS,
  DEFAULT_ABI_BYTES,
} from '../../../../../core/constants';

import { createErrorHandlers } from '../../../errors/error-ops';

const { wrapAs } = createErrorHandlers('deposits');

/**
 * Minimal gas quote shape used by deposits.
 */
export type GasQuote = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasPerPubdata?: bigint;
  maxCost: bigint; // gasLimit * maxFeePerGas
};

export type QuoteL1GasInput = {
  ctx: BuildCtx;
  tx: TransactionRequest;
  overrides?: TxOverrides;
  fallbackGasLimit?: bigint;
};

export type QuoteL2GasInput = {
  ctx: BuildCtx;
  route: DepositRoute;
  l2TxForModeling?: TransactionRequest;
  overrideGasLimit?: bigint;
};

export type ResolveErc20L2GasLimitInput = {
  ctx: BuildCtx;
  l1Token: string;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function fetchL2MaxFeePerGas(ctx: BuildCtx): Promise<bigint | undefined> {
  try {
    const fd = await ctx.client.l2.getFeeData();
    if (fd.maxFeePerGas != null) return BigInt(fd.maxFeePerGas);
    if (fd.gasPrice != null) return BigInt(fd.gasPrice);

    const legacy = ctx.client.l2 as { getGasPrice?: () => Promise<bigint> };
    if (typeof legacy.getGasPrice === 'function') {
      return await legacy.getGasPrice();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function makeGasQuote(p: {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPerPubdata?: bigint;
}): GasQuote {
  const maxPriorityFeePerGas = p.maxPriorityFeePerGas ?? 0n;
  return {
    gasLimit: p.gasLimit,
    maxFeePerGas: p.maxFeePerGas,
    maxPriorityFeePerGas,
    gasPerPubdata: p.gasPerPubdata,
    maxCost: p.gasLimit * p.maxFeePerGas,
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Quote L1 gas for a deposit transaction.
 */
export async function quoteL1Gas(input: QuoteL1GasInput): Promise<GasQuote | undefined> {
  const { ctx, tx, overrides, fallbackGasLimit } = input;

  let marketFees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | undefined;

  const getMarketFees = async () => {
    if (marketFees) return marketFees;
    const fd = await ctx.client.l1.getFeeData();
    marketFees = {
      maxFeePerGas: fd.maxFeePerGas != null ? BigInt(fd.maxFeePerGas) : 0n,
      maxPriorityFeePerGas: fd.maxPriorityFeePerGas != null ? BigInt(fd.maxPriorityFeePerGas) : 0n,
    };
    return marketFees;
  };

  const maxFeePerGas =
    overrides?.maxFeePerGas ??
    (tx.maxFeePerGas != null ? BigInt(tx.maxFeePerGas) : (await getMarketFees()).maxFeePerGas);

  const maxPriorityFeePerGas =
    overrides?.maxPriorityFeePerGas ??
    (tx.maxPriorityFeePerGas != null
      ? BigInt(tx.maxPriorityFeePerGas)
      : (await getMarketFees()).maxPriorityFeePerGas);

  const explicitGasLimit =
    overrides?.gasLimit ?? (tx.gasLimit != null ? BigInt(tx.gasLimit) : undefined);

  if (explicitGasLimit != null) {
    return makeGasQuote({
      gasLimit: explicitGasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  }

  try {
    const est = await wrapAs(
      'RPC',
      'deposits.gas.l1.estimate',
      () => ctx.client.l1.estimateGas(tx),
      { ctx: { where: 'l1.estimateGas', to: tx.to } },
    );

    const buffered = (BigInt(est) * (100n + BUFFER)) / 100n;

    return makeGasQuote({
      gasLimit: buffered,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  } catch (err) {
    if (fallbackGasLimit != null) {
      return makeGasQuote({
        gasLimit: fallbackGasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
      });
    }

    console.warn('L1 gas estimation failed', err);
    return undefined;
  }
}

/**
 * Quote L2 gas for an L2 execution.
 */
export async function quoteL2Gas(input: QuoteL2GasInput): Promise<GasQuote | undefined> {
  const { ctx, route, l2TxForModeling, overrideGasLimit } = input;

  const maxFeePerGas = await fetchL2MaxFeePerGas(ctx);
  if (maxFeePerGas == null) return undefined;

  const gasPerPubdata = ctx.gasPerPubdata;

  const txGasLimit =
    l2TxForModeling?.gasLimit != null ? BigInt(l2TxForModeling.gasLimit) : undefined;

  const explicitGasLimit = overrideGasLimit ?? txGasLimit;
  if (explicitGasLimit != null) {
    return makeGasQuote({
      gasLimit: explicitGasLimit,
      maxFeePerGas,
      gasPerPubdata,
    });
  }

  if (!l2TxForModeling) {
    return makeGasQuote({
      gasLimit: ctx.l2GasLimit ?? 0n,
      maxFeePerGas,
      gasPerPubdata,
    });
  }

  try {
    const execEstimate = await wrapAs(
      'RPC',
      'deposits.gas.l2.estimate',
      () => ctx.client.l2.estimateGas(l2TxForModeling),
      { ctx: { where: 'l2.estimateGas', to: l2TxForModeling.to } },
    );

    const memoryBytes = route === 'erc20-nonbase' ? 500n : DEFAULT_ABI_BYTES;
    const pubdataBytes = route === 'erc20-nonbase' ? 200n : DEFAULT_PUBDATA_BYTES;

    const memoryOverhead = memoryBytes * TX_MEMORY_OVERHEAD_GAS;
    const pubdataOverhead = pubdataBytes * gasPerPubdata;

    let gasLimit = BigInt(execEstimate) + TX_OVERHEAD_GAS + memoryOverhead + pubdataOverhead;

    gasLimit = (gasLimit * (100n + BUFFER)) / 100n;

    return makeGasQuote({
      gasLimit,
      maxFeePerGas,
      gasPerPubdata,
    });
  } catch (err) {
    console.warn('L2 gas estimation failed, using default fallback', err);
    return makeGasQuote({
      gasLimit: ctx.l2GasLimit ?? 0n,
      maxFeePerGas,
      gasPerPubdata,
    });
  }
}

/**
 * Resolve a safe L2 gas limit for ERC20 deposits based on whether the
 * L2 token contract is already deployed.
 * Reason: If the token is not yet deployed on L2, the deposit transaction
 * will include the deployment cost, which is higher and not
 * captured by simple estimation.
 * Instead of always using a high fallback, we can check deployment
 * status and only use the fallback when needed.
 */
export async function determineErc20L2Gas(input: {
  ctx: BuildCtx;
  l1Token: string;
  modelTx?: TransactionRequest;
}): Promise<GasQuote | undefined> {
  const { ctx, l1Token } = input;

  // Safe fallback used only when token is not deployed or estimation fails
  const DEFAULT_SAFE_L2_GAS_LIMIT = 3_000_000n;

  // Respect explicit user override
  if (ctx.l2GasLimit != null) {
    return quoteL2Gas({
      ctx,
      route: 'erc20-nonbase',
      overrideGasLimit: ctx.l2GasLimit,
    });
  }

  try {
    const { l2NativeTokenVault } = await ctx.client.contracts();
    const l2TokenAddress = (await l2NativeTokenVault.l2TokenAddress(l1Token)) as string;
    // check deployment status
    const code = await ctx.client.l2.getCode(l2TokenAddress);
    const isDeployed = code !== '0x';

    // token not deployed → skip modeling, use safe limit
    if (!isDeployed) {
      return quoteL2Gas({
        ctx,
        route: 'erc20-nonbase',
        overrideGasLimit: DEFAULT_SAFE_L2_GAS_LIMIT,
      });
    }
    // token deployed → proceed with normal estimation
    const modelTx: TransactionRequest = {
      to: input.modelTx?.to ?? ctx.sender,
      from: input.modelTx?.from ?? ctx.sender,
      data: input.modelTx?.data ?? '0x',
      value: input.modelTx?.value ?? 0n,
    };
    const gas = await quoteL2Gas({
      ctx,
      route: 'erc20-nonbase',
      l2TxForModeling: modelTx,
    });
    if (!gas) {
      return quoteL2Gas({
        ctx,
        route: 'erc20-nonbase',
        overrideGasLimit: DEFAULT_SAFE_L2_GAS_LIMIT,
      });
    }
    return gas;
  } catch (err) {
    console.warn('Failed to determine ERC20 L2 gas; defaulting to safe gas limit.', err);

    return quoteL2Gas({
      ctx,
      route: 'erc20-nonbase',
      overrideGasLimit: DEFAULT_SAFE_L2_GAS_LIMIT,
    });
  }
}
