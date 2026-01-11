// src/core/resources/deposits/gas.ts

import {
  BUFFER,
  DEFAULT_PUBDATA_BYTES,
  TX_MEMORY_OVERHEAD_GAS,
  TX_OVERHEAD_GAS,
  DEFAULT_ABI_BYTES,
} from '../../constants';
import { IBridgehubABI } from '../../abi';
import type { Address } from '../../types/primitives';
import type { GasEstimator, CoreTransactionRequest } from '../../adapters/interfaces';
import type { TxOverrides } from '../../types/fees';
import type { DepositRoute } from '../../types/flows/deposits';

export type AbiEncoder = (abi: unknown, functionName: string, args: unknown[]) => string;

export type GasQuote = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasPerPubdata?: bigint;
  maxCost: bigint; // gasLimit * maxFeePerGas
};

// Helper to create a GasQuote object
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

// Fetches current fee data from the estimator.
async function fetchFees(estimator: GasEstimator): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  try {
    const fees = await estimator.estimateFeesPerGas();
    if (fees.maxFeePerGas != null) {
      return {
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
      };
    }
    if (fees.gasPrice != null) {
      return {
        maxFeePerGas: fees.gasPrice,
        maxPriorityFeePerGas: 0n,
      };
    }
  } catch {
    // ignore
  }

  try {
    const gp = await estimator.getGasPrice();
    return { maxFeePerGas: gp, maxPriorityFeePerGas: 0n };
  } catch {
    return { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n };
  }
}

export type QuoteL1GasInput = {
  estimator: GasEstimator;
  tx: CoreTransactionRequest;
  overrides?: TxOverrides;
  fallbackGasLimit?: bigint;
};

// Quotes L1 gas for a deposit tx.
export async function quoteL1Gas(input: QuoteL1GasInput): Promise<GasQuote | undefined> {
  const { estimator, tx, overrides, fallbackGasLimit } = input;

  let market: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | undefined;
  const getMarket = async () => {
    if (market) return market;
    market = await fetchFees(estimator);
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

  const explicitGasLimit =
    overrides?.gasLimit ?? (tx.gasLimit != null ? BigInt(tx.gasLimit) : undefined);

  if (explicitGasLimit != null) {
    return makeGasQuote({ gasLimit: explicitGasLimit, maxFeePerGas, maxPriorityFeePerGas });
  }

  try {
    const est = await estimator.estimateGas(tx);
    const buffered = (BigInt(est) * (100n + BUFFER)) / 100n;
    return makeGasQuote({ gasLimit: buffered, maxFeePerGas, maxPriorityFeePerGas });
  } catch (err) {
    if (fallbackGasLimit != null) {
      return makeGasQuote({ gasLimit: fallbackGasLimit, maxFeePerGas, maxPriorityFeePerGas });
    }
    // TODO: use proper logger
    console.warn('L1 gas estimation failed', err);
    return undefined;
  }
}

export type QuoteL2GasInput = {
  estimator: GasEstimator;
  route: DepositRoute;
  tx?: CoreTransactionRequest;
  gasPerPubdata?: bigint;
  l2GasLimit?: bigint;
  overrideGasLimit?: bigint;
  stateOverrides?: Record<string, unknown>;
};

// Quotes L2 gas for a deposit tx.
export async function quoteL2Gas(input: QuoteL2GasInput): Promise<GasQuote | undefined> {
  const { estimator, route, tx, gasPerPubdata, l2GasLimit, overrideGasLimit, stateOverrides } =
    input;

  const market = await fetchFees(estimator);
  const maxFeePerGas = market.maxFeePerGas || market.maxPriorityFeePerGas || 0n;

  const txGasLimit = tx?.gasLimit != null ? BigInt(tx.gasLimit) : undefined;
  const explicit = overrideGasLimit ?? txGasLimit;

  if (explicit != null) {
    return makeGasQuote({
      gasLimit: explicit,
      maxFeePerGas,
      gasPerPubdata,
    });
  }

  if (!tx) {
    return makeGasQuote({
      gasLimit: l2GasLimit ?? 0n,
      maxFeePerGas,
      gasPerPubdata,
    });
  }

  // TODO: This rquires protocol overview because its largely based on
  // the likely outdated docs from https://github.com/matter-labs/era-contracts/blob/main/docs/l2_system_contracts/zksync_fee_model.md
  // Revisit when we have up-to-date info.
  try {
    const execEstimate = await estimator.estimateGas(tx, stateOverrides);

    // Arbitrary values used here based on observed success / failure of erc20 bridging.
    const memoryBytes = route === 'erc20-nonbase' ? 500n : DEFAULT_ABI_BYTES;
    const pubdataBytes = route === 'erc20-nonbase' ? 200n : DEFAULT_PUBDATA_BYTES;
    const pp = gasPerPubdata ?? 800n; // TODO: better way to get this?

    const memoryOverhead = memoryBytes * TX_MEMORY_OVERHEAD_GAS;
    const pubdataOverhead = pubdataBytes * pp;

    let total = BigInt(execEstimate) + TX_OVERHEAD_GAS + memoryOverhead + pubdataOverhead;
    total = (total * (100n + BUFFER)) / 100n;

    return makeGasQuote({
      gasLimit: total,
      maxFeePerGas,
      gasPerPubdata: pp,
    });
  } catch (err) {
    // TODO: use proper logger
    console.warn('L2 gas estimation failed', err);
    return makeGasQuote({
      gasLimit: l2GasLimit ?? 0n,
      maxFeePerGas,
      gasPerPubdata: gasPerPubdata,
    });
  }
}

export type QuoteL2BaseCostInput = {
  estimator: GasEstimator;
  encode: AbiEncoder;
  bridgehub: Address;
  chainId: bigint;
  l2GasLimit: bigint;
  gasPerPubdata: bigint;
};

// Quotes L2 base cost for a deposit tx.
// Calls L1 Bridgehub contract - l2TransactionBaseCost function.
export async function quoteL2BaseCost(input: QuoteL2BaseCostInput): Promise<bigint> {
  const { estimator, encode, bridgehub, chainId, l2GasLimit, gasPerPubdata } = input;

  const market = await fetchFees(estimator);
  const l1GasPrice = market.maxFeePerGas || market.maxPriorityFeePerGas || 0n;

  if (l1GasPrice === 0n) {
    throw new Error('Could not fetch L1 gas price for Bridgehub base cost calculation.');
  }

  const data = encode(IBridgehubABI, 'l2TransactionBaseCost', [
    chainId,
    l1GasPrice,
    l2GasLimit,
    gasPerPubdata,
  ]);

  const raw = await estimator.call({
    to: bridgehub,
    data,
  });

  return BigInt(raw);
}
