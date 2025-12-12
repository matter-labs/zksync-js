// src/adapters/ethers/resources/withdrawals/services/fees.ts

import type { Address } from '../../../../../core/types/primitives';
import type { WithdrawalFeeBreakdown, L2WithdrawalFeeParams } from '../../../../../core/types/fees';
import type { GasQuote } from './gas';

export type BuildWithdrawFeeBreakdownInput = {
  /** Token used to pay the L2 transaction fee */
  feeToken: Address;

  /** L2 withdrawal transaction gas quote */
  l2Gas?: GasQuote;
};

/**
 * Builds FeeBreakdown for withdrawals.
 *
 * Withdrawals represent a single L2 transaction:
 * - fees.l2 = cost of the withdraw tx on L2
 * - fees.l1 is intentionally omitted
 */
export function buildFeeBreakdown(p: BuildWithdrawFeeBreakdownInput): WithdrawalFeeBreakdown {
  const l2Total = p.l2Gas?.maxCost ?? 0n;

  const l2: L2WithdrawalFeeParams = {
    total: l2Total,
    gasLimit: p.l2Gas?.gasLimit ?? 0n,
    maxFeePerGas: p.l2Gas?.maxFeePerGas ?? 0n,
    maxPriorityFeePerGas: p.l2Gas?.maxPriorityFeePerGas,
  };

  return {
    token: p.feeToken,
    maxTotal: l2Total,
    l2,
  };
}
