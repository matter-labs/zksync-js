// src/adapters/ethers/resources/deposits/services/gas.ts

import type { TransactionRequest } from 'ethers';
import type { BuildCtx } from '../context';
import type { DepositRoute } from '../../../../../core/types/flows/deposits';
import type { TxOverrides } from '../../../../../core/types/fees';
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

export type ResolveErc20L2GasLimitInput = {
  ctx: BuildCtx;
  l1Token: string;
};

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
export async function determineErc20L2Gas(input: {
  ctx: BuildCtx;
  l1Token: string;
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
    const { l2NativeTokenVault } = await ctx.client.contracts();
    // Note: `l2TokenAddress` is now legacy way to get L2 token address for a given L1 token.
    // We will need to change this to `tokenAddress[assetId]` from the NTV
    // TODO: query the assetId on L1 using assetId mapping from l1TokenAddress https://github.com/matter-labs/era-contracts/blob/2855a3c54397d50e6925d486ae126ca8[…]3ec10fa1/l1-contracts/contracts/bridge/ntv/NativeTokenVault.sol
    // query the l2TokenAddress on l2 using assetId using tokenAddress mapping https://github.com/matter-labs/era-contracts/blob/2855a3c54397d50e6925d486ae126ca8[…]3ec10fa1/l1-contracts/contracts/bridge/ntv/NativeTokenVault.sol
    const l2TokenAddress = (await l2NativeTokenVault.l2TokenAddress(l1Token)) as string;

    // we can assume that the token has not been deployed to L2 if
    // the l2TokenAddress is the zero address. This essentially means
    // the token has not been registered on L2 yet.
    if (l2TokenAddress === '0x0000000000000000000000000000000000000000') {
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
