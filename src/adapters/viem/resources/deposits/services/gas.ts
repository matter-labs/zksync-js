// src/adapters/viem/resources/deposits/services/gas.ts

import type { TransactionRequest } from 'viem';
import type { BuildCtx } from '../context';
import type { DepositRoute } from '../../../../../core/types/flows/deposits';
import type { TxOverrides } from '../../../../../core/types/fees';
import type { Address } from '../../../../../core/types/primitives';
import type { CoreTransactionRequest } from '../../../../../core/adapters/interfaces';
import { quoteL1Gas as coreQuoteL1Gas, quoteL2Gas as coreQuoteL2Gas, type GasQuote } from '../../../../../core/resources/deposits/gas';
import { viemToGasEstimator } from '../../../../viem/estimator';

export type { GasQuote };

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
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

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
 * Quote L1 gas for a deposit transaction.
 */
export async function quoteL1Gas(input: QuoteL1GasInput): Promise<GasQuote | undefined> {
  const { ctx, tx, overrides, fallbackGasLimit } = input;
  const estimator = viemToGasEstimator(ctx.client.l1);

  return coreQuoteL1Gas({
    estimator,
    tx: toCoreTx(tx),
    overrides,
    fallbackGasLimit
  });
}

/**
 * Quote L2 gas for an L2 execution.
 */
export async function quoteL2Gas(input: QuoteL2GasInput): Promise<GasQuote | undefined> {
  const { ctx, route, l2TxForModeling, overrideGasLimit } = input;
  const estimator = viemToGasEstimator(ctx.client.l2);

  return coreQuoteL2Gas({
    estimator,
    route,
    tx: l2TxForModeling ? toCoreTx(l2TxForModeling) : undefined,
    gasPerPubdata: ctx.gasPerPubdata,
    l2GasLimit: ctx.l2GasLimit, // viem implementation uses ctx.l2GasLimit here
    overrideGasLimit
  });
}

/**
 * ERC20 deposits have an extra edge case:
 * if the token is not deployed on L2, the deposit includes deployment cost.
 */
export async function determineErc20L2Gas(input: {
  ctx: BuildCtx;
  l1Token: string;
  modelTx?: TransactionRequest;
}): Promise<GasQuote | undefined> {
  const { ctx, l1Token } = input;

  const DEFAULT_SAFE_L2_GAS_LIMIT = 3_000_000n;

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
    // viem uses getBytecode, ethers used getCode? no getBytecode returns undefined if no code? 
    // Wait, check original file content for determineErc20L2Gas.
    // Viem adapter line 257: `const code = await ctx.client.l2.getCode({ address: l2TokenAddress });`
    // getCode is deprecated for getBytecode in newer viem but sticking to what was there.

    // Actually, I should use `getBytecode` if that's what viem uses now, but if the original code used `getCode`, I should check compatibility.
    // Original code: `const code = await ctx.client.l2.getCode({ address: l2TokenAddress });`
    // `isDeployed = code !== '0x';` (Wait, viem getCode returns undefined if empty? or '0x'?)

    // I will stick to exact logic from original viem adapter to be safe.

    /* Original:
    const code = await ctx.client.l2.getCode({ address: l2TokenAddress });
    const isDeployed = code !== '0x';
    */

    const isDeployed = (code as any) !== undefined && code !== '0x'; // generic check

    if (!isDeployed) {
      return quoteL2Gas({
        ctx,
        route: 'erc20-nonbase',
        overrideGasLimit: DEFAULT_SAFE_L2_GAS_LIMIT,
      });
    }

    const rawModelTx = input.modelTx as any;

    const modelTx: TransactionRequest = {
      to: input.modelTx?.to ?? ctx.sender,
      from: input.modelTx?.from ?? (typeof rawModelTx?.account === 'string' ? rawModelTx.account : (rawModelTx?.account as any)?.address) ?? ctx.sender,
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
