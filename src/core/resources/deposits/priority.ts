import {
  L1_TX_DELTA_544_ENCODING_BYTES,
  L1_TX_INTRINSIC_L2_GAS,
  L1_TX_INTRINSIC_PUBDATA,
  L1_TX_MIN_L2_GAS_BASE,
  PRIORITY_TX_MAX_GAS_LIMIT,
  TX_MEMORY_OVERHEAD_GAS,
  TX_SLOT_OVERHEAD_L2_GAS,
} from '../../constants';

export type DirectPriorityTxGasBreakdown = {
  encodedLength: bigint;
  minBodyGas: bigint;
  overhead: bigint;
  derivedBodyGas: bigint;
  derivedL2GasLimit: bigint;
  priorityTxMaxGasLimit: bigint;
  priorityTxMaxGasLimitExceeded: boolean;
};

const PRIORITY_TX_ENCODING_STEP_BYTES = 544n;

const maxBigInt = (a: bigint, b: bigint) => (a > b ? a : b);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * Mirrors the direct priority-tx floor math used by ZKsync's TransactionValidator.
 * Source of truth for constants:
 * https://github.com/matter-labs/era-contracts/blob/main/l1-contracts/contracts/common/Config.sol
 * Mailbox encodes the priority transaction with `abi.encode(transaction)` before validation, and
 * TransactionValidator uses that encoded length to derive the minimum body gas and overhead.
 */
export function deriveDirectPriorityTxGasBreakdown(input: {
  encodedLength: bigint;
  gasPerPubdata: bigint;
}): DirectPriorityTxGasBreakdown {
  const minBodyGas =
    maxBigInt(
      L1_TX_INTRINSIC_L2_GAS +
        ceilDiv(
          input.encodedLength * L1_TX_DELTA_544_ENCODING_BYTES,
          PRIORITY_TX_ENCODING_STEP_BYTES,
        ),
      L1_TX_MIN_L2_GAS_BASE,
    ) +
    L1_TX_INTRINSIC_PUBDATA * input.gasPerPubdata;

  const overhead = maxBigInt(TX_SLOT_OVERHEAD_L2_GAS, TX_MEMORY_OVERHEAD_GAS * input.encodedLength);
  const derivedBodyGas = minBodyGas;

  return {
    encodedLength: input.encodedLength,
    minBodyGas,
    overhead,
    derivedBodyGas,
    derivedL2GasLimit: derivedBodyGas + overhead,
    priorityTxMaxGasLimit: PRIORITY_TX_MAX_GAS_LIMIT,
    priorityTxMaxGasLimitExceeded: derivedBodyGas > PRIORITY_TX_MAX_GAS_LIMIT,
  };
}
