import type { Address } from '../../types/primitives';
import {
  L1_TX_DELTA_FACTORY_DEPS_L2_GAS,
  L1_TX_DELTA_FACTORY_DEPS_PUBDATA,
  L1_TX_DELTA_544_ENCODING_BYTES,
  L1_TX_INTRINSIC_L2_GAS,
  L1_TX_INTRINSIC_PUBDATA,
  L1_TX_MIN_L2_GAS_BASE,
  PRIORITY_TX_MAX_GAS_LIMIT,
  TX_MEMORY_OVERHEAD_GAS,
  TX_SLOT_OVERHEAD_L2_GAS,
} from '../../constants';

export type PriorityTxGasBreakdown = {
  encodedLength: bigint;
  minBodyGas: bigint;
  overhead: bigint;
  derivedBodyGas: bigint;
  derivedL2GasLimit: bigint;
  priorityTxMaxGasLimit: bigint;
  priorityTxMaxGasLimitExceeded: boolean;
};

const PRIORITY_TX_ENCODING_STEP_BYTES = 544n;
const L1_TO_L2_ALIAS_OFFSET = 0x1111000000000000000000000000000000001111n;
const DEFAULT_PRIORITY_BODY_GAS_ESTIMATE_MULTIPLIER = 6n;

const maxBigInt = (a: bigint, b: bigint) => (a > b ? a : b);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export function applyL1ToL2Alias(address: Address): Address {
  return `0x${((BigInt(address) + L1_TO_L2_ALIAS_OFFSET) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`;
}

/**
 * Mirrors the priority-tx floor math used by ZKsync's TransactionValidator.
 * Source of truth for constants:
 * https://github.com/matter-labs/era-contracts/blob/main/l1-contracts/contracts/common/Config.sol
 * Mailbox encodes the priority transaction with `abi.encode(transaction)` before validation, and
 * TransactionValidator uses that encoded length to derive the minimum body gas and overhead.
 */
export function derivePriorityTxGasBreakdown(input: {
  encodedLength: bigint;
  gasPerPubdata: bigint;
  factoryDepsCount?: bigint;
}): PriorityTxGasBreakdown {
  const factoryDepsCount = input.factoryDepsCount ?? 0n;

  const minBodyGas =
    maxBigInt(
      L1_TX_INTRINSIC_L2_GAS +
        ceilDiv(
          input.encodedLength * L1_TX_DELTA_544_ENCODING_BYTES,
          PRIORITY_TX_ENCODING_STEP_BYTES,
        ) +
        factoryDepsCount * L1_TX_DELTA_FACTORY_DEPS_L2_GAS,
      L1_TX_MIN_L2_GAS_BASE,
    ) +
    L1_TX_INTRINSIC_PUBDATA * input.gasPerPubdata +
    factoryDepsCount * L1_TX_DELTA_FACTORY_DEPS_PUBDATA * input.gasPerPubdata;

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

export const deriveDirectPriorityTxGasBreakdown = derivePriorityTxGasBreakdown;

/**
 * Exact L2 estimateGas can overestimate substantially for first-bridge token deployment paths.
 * Keep the protocol floor as the lower bound, but cap pathological estimates to a multiple of the floor.
 */
export function clampPriorityBodyGasEstimate(input: {
  rawBodyGas: bigint;
  minBodyGas: bigint;
  multiplier?: bigint;
}): bigint {
  const multiplier = input.multiplier ?? DEFAULT_PRIORITY_BODY_GAS_ESTIMATE_MULTIPLIER;
  const cappedBodyGas =
    input.rawBodyGas > input.minBodyGas * multiplier
      ? input.minBodyGas * multiplier
      : input.rawBodyGas;

  return maxBigInt(cappedBodyGas, input.minBodyGas);
}
