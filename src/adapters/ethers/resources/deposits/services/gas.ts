// src/adapters/ethers/resources/deposits/services/gas.ts

import type { TransactionRequest } from 'ethers';
import type { BuildCtx } from '../context';
import type { DepositRoute } from '../../../../../core/types/flows/deposits';
import type { TxGasOverrides } from '../../../../../core/types/fees';
import type { Address } from '../../../../../core/types/primitives';
import { FORMAL_ETH_ADDRESS } from '../../../../../core/constants.ts';
import {
  quoteL1Gas as coreQuoteL1Gas,
  quoteL2Gas as coreQuoteL2Gas,
  type GasQuote,
} from '../../../../../core/resources/deposits/gas';
import { ethersToGasEstimator, toCoreTx } from '../../../../ethers/estimator';

export type { GasQuote };

export type QuoteL1GasInput = {
  ctx: BuildCtx;
  tx: TransactionRequest;
  overrides?: TxGasOverrides;
  fallbackGasLimit?: bigint;
};

export type QuoteL2GasInput = {
  ctx: BuildCtx;
  route: DepositRoute;
  l2TxForModeling?: TransactionRequest;
  overrideGasLimit?: bigint;
  stateOverrides?: Record<string, unknown>;
};

export type ResolveErc20L2GasLimitInput = {
  ctx: BuildCtx;
  l1Token: Address;
};

type DetermineNonBaseL2GasInput = {
  ctx: BuildCtx;
  route: 'erc20-nonbase' | 'eth-nonbase';
  l1Token: Address;
  knownL2Token?: Address;
  modelTx?: TransactionRequest;
  priorityFloorGasLimit?: bigint;
  undeployedGasLimit?: bigint;
};

const DEFAULT_SAFE_NONBASE_L2_GAS_LIMIT = 3_000_000n;
const ZERO_L2_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Quote L1 gas for a deposit transaction.
 */
export async function quoteL1Gas(input: QuoteL1GasInput): Promise<GasQuote | undefined> {
  const { ctx, tx, overrides, fallbackGasLimit } = input;
  const estimator = ethersToGasEstimator(ctx.client.l1);

  return coreQuoteL1Gas({
    estimator,
    tx: toCoreTx(tx),
    overrides,
    fallbackGasLimit,
  });
}

/**
 * Quote L2 gas for an L2 transaction.
 */
export async function quoteL2Gas(input: QuoteL2GasInput): Promise<GasQuote | undefined> {
  const { ctx, route, l2TxForModeling, overrideGasLimit } = input;
  const estimator = ethersToGasEstimator(ctx.client.l2);

  return coreQuoteL2Gas({
    estimator,
    route,
    tx: l2TxForModeling ? toCoreTx(l2TxForModeling) : undefined,
    gasPerPubdata: ctx.gasPerPubdata,
    l2GasLimit: ctx.l2GasLimit,
    overrideGasLimit,
    stateOverrides: input.stateOverrides,
  });
}

/**
 * Resolve a safe L2 gas limit for ERC20 deposits based on whether the
 * L2 token contract is already deployed.
 */
async function determineNonBaseL2Gas(
  input: DetermineNonBaseL2GasInput,
): Promise<GasQuote | undefined> {
  const { ctx, l1Token, route } = input;
  const fallbackQuote = () =>
    quoteL2Gas({
      ctx,
      route,
      overrideGasLimit: DEFAULT_SAFE_NONBASE_L2_GAS_LIMIT,
    });

  if (ctx.l2GasLimit != null) {
    return quoteL2Gas({
      ctx,
      route,
      overrideGasLimit: ctx.l2GasLimit,
    });
  }

  try {
    const l2TokenAddress =
      input.knownL2Token ??
      (ctx.tokens
        ? await ctx.tokens.toL2Address(l1Token)
        : ((await (await ctx.contracts.l2NativeTokenVault()).l2TokenAddress(l1Token)) as Address));

    // we can assume that the token has not been deployed to L2 if
    // the l2TokenAddress is the zero address. This essentially means
    // the token has not been registered on L2 yet.
    if (l2TokenAddress === ZERO_L2_TOKEN_ADDRESS) {
      if (input.undeployedGasLimit != null) {
        return quoteL2Gas({
          ctx,
          route,
          overrideGasLimit: input.undeployedGasLimit,
        });
      }
      return fallbackQuote();
    }

    if (input.priorityFloorGasLimit != null) {
      return quoteL2Gas({
        ctx,
        route,
        overrideGasLimit: input.priorityFloorGasLimit,
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
      route,
      l2TxForModeling: modelTx,
    });

    if (!gas || gas.gasLimit === 0n) {
      return fallbackQuote();
    }
    return gas;
  } catch (err) {
    // TODO: add proper logging
    console.warn('Failed to determine non-base deposit L2 gas; defaulting to safe gas limit.', err);

    return fallbackQuote();
  }
}

export async function determineErc20L2Gas(input: {
  ctx: BuildCtx;
  l1Token: Address;
  modelTx?: TransactionRequest;
  priorityFloorGasLimit?: bigint;
  undeployedGasLimit?: bigint;
}): Promise<GasQuote | undefined> {
  return determineNonBaseL2Gas({
    ...input,
    route: 'erc20-nonbase',
    knownL2Token: input.ctx.resolvedToken?.l2,
  });
}

export async function determineEthNonBaseL2Gas(input: {
  ctx: BuildCtx;
  modelTx?: TransactionRequest;
}): Promise<GasQuote | undefined> {
  return determineNonBaseL2Gas({
    ctx: input.ctx,
    route: 'eth-nonbase',
    l1Token: input.ctx.resolvedToken?.l1 ?? FORMAL_ETH_ADDRESS,
    knownL2Token: input.ctx.resolvedToken?.l2,
    modelTx: input.modelTx,
  });
}
