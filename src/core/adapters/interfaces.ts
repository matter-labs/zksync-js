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

  /** Estimate `tx` as an L1->L2 priority tx; rejects when the node cannot simulate that tx type. */
  estimatePriorityTxGas?(tx: CoreTransactionRequest): Promise<bigint>;

  call(tx: { to: Address; data?: string; value?: bigint; from?: Address }): Promise<string>;
}
