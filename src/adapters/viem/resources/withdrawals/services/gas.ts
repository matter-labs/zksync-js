import type { TransactionRequest } from 'viem';
import type { BuildCtx } from '../context';
import { BUFFER } from '../../../../../core/constants';
import { createErrorHandlers } from '../../../errors/error-ops';

const { wrapAs } = createErrorHandlers('withdrawals');

export type GasQuote = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxCost: bigint; // gasLimit * maxFeePerGas
};

export type QuoteWithdrawL2GasInput = {
  ctx: BuildCtx;
  tx: TransactionRequest;
};

async function fetchL2Fees(ctx: BuildCtx): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  const pc = ctx.client.l2;

  // Prefer EIP-1559 if supported, else fallback to legacy gas price.
  try {
    if (typeof pc.estimateFeesPerGas === 'function') {
      const fees = await pc.estimateFeesPerGas();
      return {
        maxFeePerGas: fees?.maxFeePerGas != null ? BigInt(fees.maxFeePerGas) : 0n,
        maxPriorityFeePerGas:
          fees?.maxPriorityFeePerGas != null ? BigInt(fees.maxPriorityFeePerGas) : 0n,
      };
    }
  } catch {
    // ignore and fall through
  }

  try {
    if (typeof pc.getGasPrice === 'function') {
      const gp = await pc.getGasPrice();
      const gasPrice = gp != null ? BigInt(gp) : 0n;
      return { maxFeePerGas: gasPrice, maxPriorityFeePerGas: 0n };
    }
  } catch {
    // ignore
  }

  return { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n };
}

function makeGasQuote(p: {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}): GasQuote {
  return {
    gasLimit: p.gasLimit,
    maxFeePerGas: p.maxFeePerGas,
    maxPriorityFeePerGas: p.maxPriorityFeePerGas,
    maxCost: p.gasLimit * p.maxFeePerGas,
  };
}

/**
 * Quotes L2 gas for a withdrawal tx.
 * Respects ctx.gasOverrides and tx fields.
 *
 * Precedence:
 * - maxFeePerGas: ctx.gasOverrides > tx > market
 * - maxPriorityFeePerGas: ctx.gasOverrides > tx > market
 * - gasLimit: ctx.gasOverrides.gasLimit > tx.gas > estimateGas()
 */
export async function quoteL2Gas(input: QuoteWithdrawL2GasInput): Promise<GasQuote | undefined> {
  const { ctx, tx } = input;

  const market = await fetchL2Fees(ctx);
  const o = ctx.gasOverrides;

  const maxFeePerGas =
    o?.maxFeePerGas ?? (tx.maxFeePerGas != null ? BigInt(tx.maxFeePerGas) : market.maxFeePerGas);

  const maxPriorityFeePerGas =
    o?.maxPriorityFeePerGas ??
    (tx.maxPriorityFeePerGas != null
      ? BigInt(tx.maxPriorityFeePerGas)
      : market.maxPriorityFeePerGas);

  const explicitGasLimit = o?.gasLimit ?? (tx.gas != null ? BigInt(tx.gas) : undefined);

  if (explicitGasLimit != null) {
    return makeGasQuote({ gasLimit: explicitGasLimit, maxFeePerGas, maxPriorityFeePerGas });
  }

  try {
    // Note: on viem, estimateGas expects `account` (sender) for many chains.
    // Ensure callers set tx.account/tx.from as appropriate.
    const est = await wrapAs(
      'RPC',
      'withdrawals.gas.l2.estimate',
      () =>
        ctx.client.l2.estimateGas({
          ...tx,
          account: ctx.client.account,
        }),
      { ctx: { where: 'l2.estimateGas', to: tx.to } },
    );

    const buffered = (BigInt(est) * (100n + BUFFER)) / 100n;

    return makeGasQuote({
      gasLimit: buffered,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  } catch (err) {
    // TODO: optional fallback?
    console.warn('Failed to estimate L2 gas for withdrawal.', err);
    return undefined;
  }
}
