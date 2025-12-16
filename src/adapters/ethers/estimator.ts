import type { Provider, TransactionRequest } from 'ethers';
import type { GasEstimator, CoreTransactionRequest } from '../../core/adapters/interfaces';

export function ethersToGasEstimator(provider: Provider): GasEstimator {
    return {
        async estimateGas(tx: CoreTransactionRequest): Promise<bigint> {
            const ethTx: TransactionRequest = {
                to: tx.to,
                from: tx.from,
                data: tx.data,
                value: tx.value,
                gasLimit: tx.gasLimit,
                maxFeePerGas: tx.maxFeePerGas,
                maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
            };
            return await provider.estimateGas(ethTx);
        },

        async estimateFeesPerGas(): Promise<{
            maxFeePerGas?: bigint;
            maxPriorityFeePerGas?: bigint;
            gasPrice?: bigint;
        }> {
            const fd = await provider.getFeeData();
            return {
                maxFeePerGas: fd.maxFeePerGas != null ? BigInt(fd.maxFeePerGas) : undefined,
                maxPriorityFeePerGas:
                    fd.maxPriorityFeePerGas != null ? BigInt(fd.maxPriorityFeePerGas) : undefined,
                gasPrice: fd.gasPrice != null ? BigInt(fd.gasPrice) : undefined,
            };
        },

        async getGasPrice(): Promise<bigint> {
            const fd = await provider.getFeeData();
            if (fd.gasPrice != null) return BigInt(fd.gasPrice);
            throw new Error('Could not fetch gas price');
        },

        async call(tx: {
            to: string;
            data?: string;
            value?: bigint;
            from?: string;
        }): Promise<string> {
            const ethTx: TransactionRequest = {
                to: tx.to,
                data: tx.data,
                value: tx.value,
                from: tx.from,
            };
            return await provider.call(ethTx);
        }
    };
}
