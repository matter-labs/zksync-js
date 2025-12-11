import type { Address } from './primitives';

// Minimal public gas parameters shared across adapters
export type GasParams = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  maxGasCost: bigint; // gasLimit * maxFeePerGas
  gasPerPubdata?: bigint;
};

// Minimal public fee breakdown shared across adapters
export type FeeBreakdown = {
  token: Address; // fee token address
  total: bigint; // primary UI fee value (base units of token)
  components?: {
    l1Execution?: bigint;
    l2Execution?: bigint;
    l2BaseCost?: bigint;
    mintValue?: bigint;
    operatorTip?: bigint;
    refund?: bigint;
  };
  gas?: {
    l1?: GasParams;
    l2?: GasParams;
  };
};

// Ready-to-use transaction overrides
export type TxOverrides = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
};
