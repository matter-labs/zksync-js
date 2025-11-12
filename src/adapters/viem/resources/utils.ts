// src/adapters/viem/resources/utils.ts
import { encodeAbiParameters, keccak256, concat, type Hex } from 'viem';
import type { Address } from '../../../core/types';
import {
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
  L1_FEE_ESTIMATION_COEF_DENOMINATOR,
  L1_FEE_ESTIMATION_COEF_NUMERATOR,
  ETH_ADDRESS,
} from '../../../core/constants';

import type { ViemClient } from '../client';
import type { Eip1559GasOverrides, ResolvedEip1559Fees } from '../../../core/types/flows/base';
import { assertNoLegacyGas, assertPriorityFeeBounds } from '../../../core/utils/gas';

/* -----------------------------------------------------------------------------
 * Native Token Vault encoding
 * ---------------------------------------------------------------------------*/

// Returns the assetId for a token in the Native Token Vault with specific origin chainId and address
export function encodeNativeTokenVaultAssetId(chainId: bigint, address: string): Hex {
  const encoded = encodeAbiParameters(
    [
      { type: 'uint256', name: 'originChainId' },
      { type: 'address', name: 'ntv' },
      { type: 'address', name: 'token' },
    ],
    [chainId, L2_NATIVE_TOKEN_VAULT_ADDRESS, address as Address],
  );
  return keccak256(encoded);
}

// Encodes the data for a transfer of a token through the Native Token Vault
export function encodeNativeTokenVaultTransferData(
  amount: bigint,
  receiver: Address,
  token: Address,
): Hex {
  return encodeAbiParameters(
    [
      { type: 'uint256', name: 'amount' },
      { type: 'address', name: 'receiver' },
      { type: 'address', name: 'token' },
    ],
    [amount, receiver, token],
  );
}

// Encodes the data for a second bridge transfer (V1)
export function encodeSecondBridgeDataV1(assetId: Hex, transferData: Hex): Hex {
  const data = encodeAbiParameters(
    [
      { type: 'bytes32', name: 'assetId' },
      { type: 'bytes', name: 'transferData' },
    ],
    [assetId, transferData],
  );
  return concat(['0x01', data]);
}

/* Aliases kept for parity with ethers utils */
export const encodeNTVAssetId = encodeNativeTokenVaultAssetId;
export const encodeNTVTransferData = encodeNativeTokenVaultTransferData;

// TODO: remove in next major
/* -----------------------------------------------------------------------------
 * Gas helpers
 * ---------------------------------------------------------------------------*/

export function scaleGasLimit(gasLimit: bigint): bigint {
  return (
    (gasLimit * BigInt(L1_FEE_ESTIMATION_COEF_NUMERATOR)) /
    BigInt(L1_FEE_ESTIMATION_COEF_DENOMINATOR)
  );
}

/** Throws if baseCost > value */
export async function checkBaseCost(
  baseCost: bigint,
  value: bigint | Promise<bigint>,
): Promise<void> {
  const resolved = await value;
  if (baseCost > resolved) {
    throw new Error(
      'The base cost of performing the priority operation is higher than the provided value parameter ' +
        `for the transaction: baseCost: ${String(baseCost)}, provided value: ${String(resolved)}!`,
    );
  }
}

export type FeeOverrides = ResolvedEip1559Fees & { gasPriceForBaseCost: bigint };

export async function getFeeOverrides(
  client: ViemClient,
  overrides?: Eip1559GasOverrides,
): Promise<FeeOverrides> {
  assertNoLegacyGas(overrides);

  let maxFeePerGasFromProvider: bigint | undefined;
  let maxPriorityFromProvider: bigint | undefined;
  let gasPriceFromProvider: bigint | undefined;
  try {
    // viem: estimateFeesPerGas returns { maxFeePerGas, maxPriorityFeePerGas, baseFeePerGas, gasPrice? }
    const fees = await client.l1.estimateFeesPerGas();
    const { maxFeePerGas, maxPriorityFeePerGas } = fees;
    if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
      maxFeePerGasFromProvider = maxFeePerGas;
      maxPriorityFromProvider = maxPriorityFeePerGas;
      gasPriceFromProvider = fees.gasPrice ?? maxFeePerGas;
    } else if (fees.gasPrice != null) {
      gasPriceFromProvider = fees.gasPrice;
    }
  } catch {
    // fall through to legacy
  }

  if (gasPriceFromProvider == null) {
    try {
      gasPriceFromProvider = await client.l1.getGasPrice();
    } catch {
      // ignore
    }
  }

  const maxFeePerGas = overrides?.maxFeePerGas ?? maxFeePerGasFromProvider ?? gasPriceFromProvider;
  if (maxFeePerGas == null) {
    throw new Error('L1 provider returned no gas price data');
  }

  const maxPriorityFeePerGas =
    overrides?.maxPriorityFeePerGas ?? maxPriorityFromProvider ?? maxFeePerGas;

  assertPriorityFeeBounds({ maxFeePerGas, maxPriorityFeePerGas });

  const gasPriceForBaseCost =
    overrides?.maxFeePerGas ?? maxFeePerGasFromProvider ?? gasPriceFromProvider ?? maxFeePerGas;

  return {
    gasLimit: overrides?.gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasPriceForBaseCost,
  };
}

export async function getL2FeeOverrides(
  client: ViemClient,
  overrides?: Eip1559GasOverrides,
): Promise<ResolvedEip1559Fees> {
  assertNoLegacyGas(overrides);

  let maxFeePerGasFromProvider: bigint | undefined;
  let maxPriorityFromProvider: bigint | undefined;
  let gasPriceFromProvider: bigint | undefined;
  try {
    const fees = await client.l2.estimateFeesPerGas();
    if (fees?.maxFeePerGas != null && fees.maxPriorityFeePerGas != null) {
      maxFeePerGasFromProvider = fees.maxFeePerGas;
      maxPriorityFromProvider = fees.maxPriorityFeePerGas;
      gasPriceFromProvider = fees.gasPrice ?? fees.maxFeePerGas;
    } else if (fees?.gasPrice != null) {
      gasPriceFromProvider = fees.gasPrice;
    }
  } catch {
    // ignore
  }

  if (gasPriceFromProvider == null) {
    try {
      gasPriceFromProvider = await client.l2.getGasPrice();
    } catch {
      // ignore
    }
  }

  const maxFeePerGas = overrides?.maxFeePerGas ?? maxFeePerGasFromProvider ?? gasPriceFromProvider;
  if (maxFeePerGas == null) {
    throw new Error('provider returned no gas price data');
  }

  const maxPriorityFeePerGas =
    overrides?.maxPriorityFeePerGas ?? maxPriorityFromProvider ?? maxFeePerGas;

  assertPriorityFeeBounds({ maxFeePerGas, maxPriorityFeePerGas });

  return {
    gasLimit: overrides?.gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
}

export function buildViemFeeOverrides(fees: ResolvedEip1559Fees): Record<string, unknown> {
  return {
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    gas: fees.gasLimit,
  };
}

/** Fetches the gas price in wei (legacy) or falls back to maxFeePerGas. */
export async function getGasPriceWei(client: ViemClient): Promise<bigint> {
  try {
    const gp = await client.l1.getGasPrice();
    if (gp != null) return gp;
  } catch {
    // ignore
  }
  try {
    const fees = await client.l1.estimateFeesPerGas();
    if (fees?.maxFeePerGas != null) return fees.maxFeePerGas;
  } catch {
    // ignore
  }
  throw new Error('provider returned no gas price data');
}

/* -----------------------------------------------------------------------------
 * L2 request builders (ETH direct)
 * ---------------------------------------------------------------------------*/

export function buildDirectRequestStruct(args: {
  chainId: bigint;
  mintValue: bigint;
  l2GasLimit: bigint;
  gasPerPubdata: bigint;
  refundRecipient: Address;
  l2Contract: Address;
  l2Value: bigint;
}) {
  return {
    chainId: args.chainId,
    l2Contract: args.l2Contract,
    mintValue: args.mintValue,
    l2Value: args.l2Value,
    l2Calldata: '0x' as Hex,
    l2GasLimit: args.l2GasLimit,
    l2GasPerPubdataByteLimit: args.gasPerPubdata,
    factoryDeps: [] as Hex[],
    refundRecipient: args.refundRecipient,
  };
}

/* -----------------------------------------------------------------------------
 * Two-bridges encoding: generic tuple (token, amount, l2Receiver)
 * ---------------------------------------------------------------------------*/
export function encodeSecondBridgeArgs(token: Address, amount: bigint, l2Receiver: Address): Hex {
  return encodeAbiParameters(
    [
      { type: 'address', name: 'token' },
      { type: 'uint256', name: 'amount' },
      { type: 'address', name: 'l2Receiver' },
    ],
    [token, amount, l2Receiver],
  );
}

/* -----------------------------------------------------------------------------
 * Two-bridges encoding: ERC20 tuple (token, amount, l2Receiver)
 * ---------------------------------------------------------------------------*/
export function encodeSecondBridgeErc20Args(
  token: Address,
  amount: bigint,
  l2Receiver: Address,
): Hex {
  return encodeSecondBridgeArgs(token, amount, l2Receiver);
}

/* -----------------------------------------------------------------------------
 * Two-bridges encoding: ETH convenience (uses ETH sentinel address)
 * ---------------------------------------------------------------------------*/
export function encodeSecondBridgeEthArgs(
  amount: bigint,
  l2Receiver: Address,
  ethToken: Address = ETH_ADDRESS,
): Hex {
  return encodeSecondBridgeArgs(ethToken, amount, l2Receiver);
}
