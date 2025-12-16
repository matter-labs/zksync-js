import type { Provider, TransactionRequest } from 'ethers';
import type { GasEstimator, CoreTransactionRequest } from '../../core/adapters/interfaces';
import type { Address } from '../../core/types/primitives';

// Converts an Ethers TransactionRequest to an agnostic CoreTransactionRequest.
export function toCoreTx(tx: TransactionRequest): CoreTransactionRequest {
  return {
    to: tx.to as Address,
    from: tx.from as Address,
    data: tx.data as string,
    value: tx.value ? BigInt(tx.value) : undefined,
    gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
    maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
  };
}

// Converts an Ethers Provider to a GasEstimator compatible with the core abstractions.
// This allows the core logic to estimate gas using the Ethers.js provider.
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

    async call(tx: { to: string; data?: string; value?: bigint; from?: string }): Promise<string> {
      const ethTx: TransactionRequest = {
        to: tx.to,
        data: tx.data,
        value: tx.value,
        from: tx.from,
      };
      return await provider.call(ethTx);
    },
  };
}
