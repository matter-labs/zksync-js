import type { Address } from '../types/primitives';

export interface CoreTransactionRequest {
  to: Address;
  from?: Address;
  data?: string;
  value?: bigint;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface GasEstimator {
  estimateGas(
    tx: CoreTransactionRequest,
    stateOverrides?: Record<string, unknown>,
  ): Promise<bigint>;

  estimateFeesPerGas(): Promise<{
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    gasPrice?: bigint;
  }>;

  getGasPrice(): Promise<bigint>;

  call(tx: { to: Address; data?: string; value?: bigint; from?: Address }): Promise<string>;
}
