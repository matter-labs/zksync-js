// src/adapters/viem/resources/deposits/services/gas.ts

import type { TransactionRequest } from 'viem';
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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

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

async function fetchL2MaxFeePerGas(ctx: BuildCtx): Promise<bigint | undefined> {
  try {
    // viem: publicClient.estimateFeesPerGas() is preferred, fallback to getGasPrice()
    const pc = ctx.client.l2;

    if (typeof pc.estimateFeesPerGas === 'function') {
      const fees = await pc.estimateFeesPerGas();
      if (fees?.maxFeePerGas != null) return BigInt(fees.maxFeePerGas);
    }

    if (typeof pc.getGasPrice === 'function') {
      const gp = await pc.getGasPrice();
      if (gp != null) return BigInt(gp);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function fetchL1Fees(ctx: BuildCtx): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  const pc = ctx.client.l1;

  // Prefer EIP-1559 if possible, fallback to legacy gas price
  if (typeof pc.estimateFeesPerGas === 'function') {
    const fees = await pc.estimateFeesPerGas();
    return {
      maxFeePerGas: fees?.maxFeePerGas != null ? BigInt(fees.maxFeePerGas) : 0n,
      maxPriorityFeePerGas:
        fees?.maxPriorityFeePerGas != null ? BigInt(fees.maxPriorityFeePerGas) : 0n,
    };
  }

  if (typeof pc.getGasPrice === 'function') {
    const gp = await pc.getGasPrice();
    const gasPrice = gp != null ? BigInt(gp) : 0n;
    return { maxFeePerGas: gasPrice, maxPriorityFeePerGas: 0n };
  }

  return { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Quote L1 gas for a deposit transaction.
 */
export async function quoteL1Gas(input: QuoteL1GasInput): Promise<GasQuote | undefined> {
  const { ctx, tx, overrides, fallbackGasLimit } = input;

  let market: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | undefined;
  const getMarket = async () => {
    if (market) return market;
    market = await fetchL1Fees(ctx);
    return market;
  };

  const maxFeePerGas =
    overrides?.maxFeePerGas ??
    (tx.maxFeePerGas != null ? BigInt(tx.maxFeePerGas) : (await getMarket()).maxFeePerGas);

  const maxPriorityFeePerGas =
    overrides?.maxPriorityFeePerGas ??
    (tx.maxPriorityFeePerGas != null
      ? BigInt(tx.maxPriorityFeePerGas)
      : (await getMarket()).maxPriorityFeePerGas);

  const explicitGasLimit = overrides?.gasLimit ?? (tx.gas != null ? BigInt(tx.gas) : undefined);

  if (explicitGasLimit != null) {
    return makeGasQuote({ gasLimit: explicitGasLimit, maxFeePerGas, maxPriorityFeePerGas });
  }

  try {
    const est = await wrapAs(
      'RPC',
      'deposits.gas.l1.estimate',
      () =>
        ctx.client.l1.estimateGas({
          ...tx,
          account: ctx.client.account,
        }),
      { ctx: { where: 'l1.estimateGas', to: tx.to } },
    );

    const buffered = (BigInt(est) * (100n + BUFFER)) / 100n;
    return makeGasQuote({ gasLimit: buffered, maxFeePerGas, maxPriorityFeePerGas });
  } catch (err) {
    if (fallbackGasLimit != null) {
      return makeGasQuote({ gasLimit: fallbackGasLimit, maxFeePerGas, maxPriorityFeePerGas });
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

  const txGasLimit = l2TxForModeling?.gas != null ? BigInt(l2TxForModeling.gas) : undefined;

  const explicitGasLimit = overrideGasLimit ?? txGasLimit;
  if (explicitGasLimit != null) {
    return makeGasQuote({ gasLimit: explicitGasLimit, maxFeePerGas, gasPerPubdata });
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
      () =>
        ctx.client.l2.estimateGas({
          ...l2TxForModeling,
          account: ctx.client.account,
        }),
      { ctx: { where: 'l2.estimateGas', to: l2TxForModeling.to } },
    );

    const memoryBytes = route === 'erc20-nonbase' ? 500n : DEFAULT_ABI_BYTES;
    const pubdataBytes = route === 'erc20-nonbase' ? 200n : DEFAULT_PUBDATA_BYTES;

    const memoryOverhead = memoryBytes * TX_MEMORY_OVERHEAD_GAS;
    const pubdataOverhead = pubdataBytes * gasPerPubdata;

    let gasLimit = BigInt(execEstimate) + TX_OVERHEAD_GAS + memoryOverhead + pubdataOverhead;
    gasLimit = (gasLimit * (100n + BUFFER)) / 100n;

    return makeGasQuote({ gasLimit, maxFeePerGas, gasPerPubdata });
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
 * ERC20 deposits have an extra edge case:
 * if the token is not deployed on L2, the deposit includes deployment cost.
 * We detect deployment and either:
 * - deployed => do a modeled quote (estimateGas)
 * - not deployed / error => use safe fallback limit
 */
export async function determineErc20L2Gas(input: {
  ctx: BuildCtx;
  l1Token: string;
  modelTx?: TransactionRequest;
}): Promise<GasQuote | undefined> {
  const { ctx, l1Token } = input;

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
    const l2NativeTokenVault = (await ctx.client.contracts()).l2NativeTokenVault;
    const l2TokenAddress = await ctx.client.l2.readContract({
      address: l2NativeTokenVault.address,
      abi: l2NativeTokenVault.abi,
      functionName: 'l2TokenAddress',
      args: [l1Token as `0x${string}`],
    });
    const code = await ctx.client.l2.getCode({ address: l2TokenAddress });
    const isDeployed = code !== '0x';

    if (!isDeployed) {
      return quoteL2Gas({
        ctx,
        route: 'erc20-nonbase',
        overrideGasLimit: DEFAULT_SAFE_L2_GAS_LIMIT,
      });
    }

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
