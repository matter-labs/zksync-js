// src/adapters/viem/resources/deposits/services/gas.ts

import { zeroAddress, type TransactionRequest } from 'viem';
import type { BuildCtx } from '../context';
import type { DepositRoute } from '../../../../../core/types/flows/deposits';
import type { TxOverrides } from '../../../../../core/types/fees';
import type { Address } from '../../../../../core/types/primitives';
import {
  quoteL1Gas as coreQuoteL1Gas,
  quoteL2Gas as coreQuoteL2Gas,
  type GasQuote,
} from '../../../../../core/resources/deposits/gas';
import { viemToGasEstimator, toCoreTx } from '../../../../viem/estimator';

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
  stateOverrides?: Record<string, unknown>;
};

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

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
    fallbackGasLimit,
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
    l2GasLimit: ctx.l2GasLimit, // TODO: investigate if this should be passed here; weird viem quirk
    overrideGasLimit,
    stateOverrides: input.stateOverrides,
  });
}

/**
 * ERC20 deposits have an extra edge case:
 * if the token is not deployed on L2, the deposit includes deployment cost.
 */
export async function determineErc20L2Gas(input: {
  ctx: BuildCtx;
  l1Token: Address;
  modelTx?: TransactionRequest;
}): Promise<GasQuote | undefined> {
  const { ctx, l1Token } = input;

  // Arbitrarily chosen safe gas limit for ERC20 deposits
  const DEFAULT_SAFE_L2_GAS_LIMIT = 3_000_000n;

  if (ctx.l2GasLimit != null) {
    return quoteL2Gas({
      ctx,
      route: 'erc20-nonbase',
      overrideGasLimit: ctx.l2GasLimit,
    });
  }

  try {
    const l2TokenAddress = ctx.tokens
      ? await ctx.tokens.toL2Address(l1Token)
      : await (async () => {
          const l2NativeTokenVault = (await ctx.client.contracts()).l2NativeTokenVault;
          return (await ctx.client.l2.readContract({
            address: l2NativeTokenVault.address,
            abi: l2NativeTokenVault.abi,
            functionName: 'l2TokenAddress',
            args: [l1Token as `0x${string}`],
          })) as Address;
        })();

    // we can assume that the token has not been deployed to L2 if
    // the l2TokenAddress is the zero address. This essentially means
    // the token has not been registered on L2 yet.
    if (l2TokenAddress === zeroAddress) {
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
    // TODO: add proper logging
    console.warn('Failed to determine ERC20 L2 gas; defaulting to safe gas limit.', err);

    return quoteL2Gas({
      ctx,
      route: 'erc20-nonbase',
      overrideGasLimit: DEFAULT_SAFE_L2_GAS_LIMIT,
    });
  }
}
