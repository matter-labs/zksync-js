import type { Eip1559GasOverrides } from '../types/flows/base';

/**
 * Ensures a user-supplied override does not include legacy gas properties.
 * Throws if `gasPrice` is present.
 */
export function assertNoLegacyGas(
  overrides: Eip1559GasOverrides | (Eip1559GasOverrides & Record<string, unknown>) | undefined,
): void {
  if (!overrides) return;
  if ('gasPrice' in overrides && overrides.gasPrice !== undefined) {
    throw new Error('Legacy gasPrice is not supported; use EIP-1559 fields instead.');
  }
}

/**
 * Validates that maxPriorityFeePerGas does not exceed maxFeePerGas.
 */
export function assertPriorityFeeBounds(fees: {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}): void {
  if (fees.maxPriorityFeePerGas > fees.maxFeePerGas) {
    throw new Error('maxPriorityFeePerGas cannot exceed maxFeePerGas.');
  }
}
