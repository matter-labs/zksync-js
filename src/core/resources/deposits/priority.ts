import type { Address } from '../../types/primitives';
import {
  L1_TX_DELTA_FACTORY_DEPS_L2_GAS,
  L1_TX_DELTA_FACTORY_DEPS_PUBDATA,
  L1_TX_CALLDATA_FLOOR_PRICE_L2_GAS_ZKSYNC_OS,
  L1_TX_DELTA_544_ENCODING_BYTES,
  L1_TX_INTRINSIC_L2_GAS,
  L1_TX_INTRINSIC_L2_GAS_ZKSYNC_OS,
  L1_TX_INTRINSIC_PUBDATA,
  L1_TX_INTRINSIC_PUBDATA_ZKSYNC_OS,
  L1_TX_MIN_L2_GAS_BASE,
  L1_TX_NATIVE_PER_GAS,
  MAX_NATIVE_COMPUTATIONAL_ZKSYNC_OS,
  PRIORITY_TX_MAX_GAS_LIMIT,
  REGISTERED_TOKEN_BRIDGE_MINT_EXECUTION_GAS,
  REGISTERED_TOKEN_BRIDGE_MINT_PUBDATA_BYTES,
  TX_MEMORY_OVERHEAD_GAS,
  TX_SLOT_OVERHEAD_L2_GAS,
} from '../../constants';
import { applyGasBuffer } from './gas';

export type PriorityTxGasBreakdown = {
  encodedLength: bigint;
  minBodyGas: bigint;
  overhead: bigint;
  derivedBodyGas: bigint;
  derivedL2GasLimit: bigint;
  priorityTxMaxGasLimit: bigint;
  priorityTxMaxGasLimitExceeded: boolean;
};

/** The L2 call a priority tx performs, as seen from L2 (aliased L1 sender). */
export type PriorityTxL2Leg = {
  from: Address;
  to: Address;
  data: `0x${string}`;
};

const PRIORITY_TX_ENCODING_STEP_BYTES = 544n;
const L1_TO_L2_ALIAS_OFFSET = 0x1111000000000000000000000000000000001111n;
export const DEFAULT_PRIORITY_BODY_GAS_ESTIMATE_MULTIPLIER = 7n;
const PRIORITY_L2_GAS_BUFFER = 40n;

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

export function derivePriorityBodyGasEstimateCap(input: {
  minBodyGas: bigint;
  multiplier?: bigint;
}): bigint {
  return input.minBodyGas * (input.multiplier ?? DEFAULT_PRIORITY_BODY_GAS_ESTIMATE_MULTIPLIER);
}

export function applyPriorityL2GasLimitBuffer(input: {
  chainIdL2: bigint;
  gasLimit: bigint;
}): bigint {
  return (input.gasLimit * (100n + PRIORITY_L2_GAS_BUFFER)) / 100n;
}

/**
 * Minimum `l2GasLimit` the L1 Mailbox accepts for a priority tx on ZKsync OS (protocol v33+).
 * Below it `requestL2TransactionDirect` reverts with `ValidateTxnNotEnoughGas()`.
 */
export function minimalPriorityTxL2Gas(input: {
  calldataLength: bigint;
  gasPerPubdata: bigint;
}): bigint {
  const intrinsic =
    L1_TX_INTRINSIC_L2_GAS_ZKSYNC_OS +
    L1_TX_CALLDATA_FLOOR_PRICE_L2_GAS_ZKSYNC_OS * input.calldataLength;
  const pubdata =
    L1_TX_INTRINSIC_PUBDATA_ZKSYNC_OS * input.gasPerPubdata +
    ceilDiv(MAX_NATIVE_COMPUTATIONAL_ZKSYNC_OS, L1_TX_NATIVE_PER_GAS);

  return maxBigInt(intrinsic, pubdata);
}

export function clampPriorityL2GasLimit(input: {
  gasLimit: bigint;
  l2Calldata: `0x${string}`;
  gasPerPubdata: bigint;
}): bigint {
  return maxBigInt(
    input.gasLimit,
    minimalPriorityTxL2Gas({
      calldataLength: BigInt(Math.max(input.l2Calldata.length - 2, 0) / 2),
      gasPerPubdata: input.gasPerPubdata,
    }),
  );
}

/**
 * `l2GasLimit` for finalizing a deposit of a token that already exists on L2.
 * The validator floor only covers L1-side validation, so the real execution comes from the node's
 * priority-tx estimate, or from the measured bridge-mint model when the node cannot provide one.
 */
export function resolveRegisteredTokenPriorityL2GasLimit(input: {
  chainIdL2: bigint;
  priorityFloorGasLimit: bigint;
  gasPerPubdata: bigint;
  nodeEstimate?: bigint;
}): bigint {
  if (input.nodeEstimate != null && input.nodeEstimate > 0n) {
    return maxBigInt(input.priorityFloorGasLimit, applyGasBuffer(input.nodeEstimate));
  }

  const modeledGas =
    REGISTERED_TOKEN_BRIDGE_MINT_EXECUTION_GAS +
    REGISTERED_TOKEN_BRIDGE_MINT_PUBDATA_BYTES * input.gasPerPubdata;

  return maxBigInt(
    input.priorityFloorGasLimit,
    applyPriorityL2GasLimitBuffer({ chainIdL2: input.chainIdL2, gasLimit: modeledGas }),
  );
}
