import { BUFFER } from '../../constants';
import type { GasEstimator, CoreTransactionRequest } from '../../adapters/interfaces';
import type { TxOverrides } from '../../types/fees';

export type GasQuote = {
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    maxCost: bigint; // gasLimit * maxFeePerGas
};

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

export type QuoteWithdrawL2GasInput = {
    estimator: GasEstimator;
    tx: CoreTransactionRequest;
    overrides?: TxOverrides;
};

export async function quoteL2Gas(input: QuoteWithdrawL2GasInput): Promise<GasQuote | undefined> {
    const { estimator, tx, overrides } = input;

    const market = await fetchFees(estimator);
    const o = overrides;

    const maxFeePerGas =
        o?.maxFeePerGas ?? (tx.maxFeePerGas != null ? BigInt(tx.maxFeePerGas) : market.maxFeePerGas);

    const maxPriorityFeePerGas =
        o?.maxPriorityFeePerGas ??
        (tx.maxPriorityFeePerGas != null
            ? BigInt(tx.maxPriorityFeePerGas)
            : market.maxPriorityFeePerGas);

    const explicitGasLimit =
        o?.gasLimit ?? (tx.gasLimit != null ? BigInt(tx.gasLimit) : undefined);

    if (explicitGasLimit != null) {
        return makeGasQuote({
            gasLimit: explicitGasLimit,
            maxFeePerGas,
            maxPriorityFeePerGas,
        });
    }

    try {
        // estimateGas
        const est = await estimator.estimateGas(tx);
        const buffered = (BigInt(est) * (100n + BUFFER)) / 100n;
        return makeGasQuote({
            gasLimit: buffered,
            maxFeePerGas,
            maxPriorityFeePerGas,
        });
    } catch (err) {
        console.warn('Failed to estimate L2 gas for withdrawal.', err);
        return undefined;
    }
}
