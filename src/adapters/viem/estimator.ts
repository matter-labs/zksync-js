import type {
  PublicClient,
  Address,
  Hash,
  TransactionRequest,
  RpcAccountStateOverride,
} from 'viem';
import type { GasEstimator, CoreTransactionRequest } from '../../core/adapters/interfaces';

export function toCoreTx(tx: TransactionRequest): CoreTransactionRequest {
  return {
    to: tx.to as Address,
    from: tx.from as Address,
    data: tx.data as string,
    value: tx.value,
    gasLimit: tx.gas,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
  };
}

export function viemToGasEstimator(client: PublicClient): GasEstimator {
  return {
    async estimateGas(
      tx: CoreTransactionRequest,
      stateOverrides?: RpcAccountStateOverride,
    ): Promise<bigint> {
      if (stateOverrides) {
        try {
          const result = await client.request({
            method: 'eth_estimateGas',
            params: [
              {
                from: tx.from as Address,
                to: tx.to,
                data: tx.data as Hash,
                value: tx.value as unknown as `0x${string}`,
                gas: tx.gasLimit as unknown as `0x${string}`,
                maxFeePerGas: tx.maxFeePerGas as unknown as `0x${string}`,
                maxPriorityFeePerGas: tx.maxPriorityFeePerGas as unknown as `0x${string}`,
              },
              'latest',
              stateOverrides,
            ],
          });
          return BigInt(result as string);
        } catch (error) {
          console.warn(
            'Failed to estimate gas with state overrides, falling back to standard estimation:',
            error,
          );
        }
      }

      return await client.estimateGas({
        account: tx.from as Address,
        to: tx.to,
        data: tx.data as Hash,
        value: tx.value,
        gas: tx.gasLimit,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      });
    },

    async estimateFeesPerGas(): Promise<{
      maxFeePerGas?: bigint;
      maxPriorityFeePerGas?: bigint;
      gasPrice?: bigint;
    }> {
      // Try EIP-1559
      try {
        const fees = await client.estimateFeesPerGas();
        return {
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        };
      } catch {
        // Fallback or ignore
      }

      try {
        const gp = await client.getGasPrice();
        return { gasPrice: gp };
      } catch {
        return {};
      }
    },

    async getGasPrice(): Promise<bigint> {
      return await client.getGasPrice();
    },

    async call(tx: { to: string; data?: string; value?: bigint; from?: string }): Promise<string> {
      const res = await client.call({
        to: tx.to as Address,
        data: tx.data as Hash,
        value: tx.value,
        account: tx.from as Address,
      });
      return res.data ?? '0x';
    },
  };
}
