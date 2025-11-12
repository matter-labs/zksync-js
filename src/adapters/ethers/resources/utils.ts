import { AbiCoder, ethers } from 'ethers';
import type { Address } from '../../../core/types';
import {
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
  L1_FEE_ESTIMATION_COEF_DENOMINATOR,
  L1_FEE_ESTIMATION_COEF_NUMERATOR,
  ETH_ADDRESS,
} from '../../../core/constants';
import type { EthersClient } from '../client';
import type { Eip1559GasOverrides, ResolvedEip1559Fees } from '../../../core/types/flows/base';
import { assertNoLegacyGas, assertPriorityFeeBounds } from '../../../core/utils/gas';
import type { FeeData } from 'ethers';

function supportsGetGasPrice(
  provider: unknown,
): provider is { getGasPrice(): Promise<bigint | { toString(): string }> } {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    typeof (provider as { getGasPrice?: unknown }).getGasPrice === 'function'
  );
}

// TODO: refactor this entirely
// separate encoding, and move gas helpers to new resource

// Returns the assetId for a token in the Native Token Vault with specific origin chainId and address
export function encodeNativeTokenVaultAssetId(chainId: bigint, address: string) {
  const abi = new AbiCoder();
  const hex = abi.encode(
    ['uint256', 'address', 'address'],
    [chainId, L2_NATIVE_TOKEN_VAULT_ADDRESS, address],
  );
  return ethers.keccak256(hex);
}

// Encodes the data for a transfer of a token through the Native Token Vault
export function encodeNativeTokenVaultTransferData(
  amount: bigint,
  receiver: Address,
  token: Address,
) {
  return new AbiCoder().encode(['uint256', 'address', 'address'], [amount, receiver, token]);
}

// Encodes the data for a second bridge transfer
export function encodeSecondBridgeDataV1(assetId: string, transferData: string) {
  const abi = new AbiCoder();
  const data = abi.encode(['bytes32', 'bytes'], [assetId, transferData]);

  return ethers.concat(['0x01', data]);
}
// Encodes the data for a second bridge transfer
export function encodeNTVAssetId(chainId: bigint, address: string) {
  const abi = new AbiCoder();
  const hex = abi.encode(
    ['uint256', 'address', 'address'],
    [chainId, L2_NATIVE_TOKEN_VAULT_ADDRESS, address],
  );
  return ethers.keccak256(hex);
}

// Encodes the data for a transfer of a token through the Native Token Vault
export function encodeNTVTransferData(amount: bigint, receiver: Address, token: Address) {
  return new AbiCoder().encode(['uint256', 'address', 'address'], [amount, receiver, token]);
}

// Scales the provided gas limit by the L1 fee estimation coefficient
export function scaleGasLimit(gasLimit: bigint): bigint {
  return (
    (gasLimit * BigInt(L1_FEE_ESTIMATION_COEF_NUMERATOR)) /
    BigInt(L1_FEE_ESTIMATION_COEF_DENOMINATOR)
  );
}

// Checks the base cost is not higher than the provided value
export async function checkBaseCost(
  baseCost: ethers.BigNumberish,
  value: ethers.BigNumberish | Promise<ethers.BigNumberish>,
): Promise<void> {
  const resolvedValue = await value;
  if (baseCost > resolvedValue) {
    throw new Error(
      'The base cost of performing the priority operation is higher than the provided value parameter ' +
        `for the transaction: baseCost: ${String(baseCost)}, provided value: ${String(resolvedValue)}!`,
    );
  }
}

// --- Gas + fees ---
export type ResolvedFeeOverrides = ResolvedEip1559Fees & {
  gasPriceForBaseCost: bigint;
};

export async function getFeeOverrides(
  client: EthersClient,
  overrides?: Eip1559GasOverrides,
): Promise<ResolvedFeeOverrides> {
  assertNoLegacyGas(overrides);

  const fd: FeeData = await client.l1.getFeeData();
  const maxFeeFromProvider = fd.maxFeePerGas ?? undefined;
  const maxPriorityFromProvider = fd.maxPriorityFeePerGas ?? undefined;
  const gasPriceFallback = fd.gasPrice ?? undefined;

  const maxFeePerGas = overrides?.maxFeePerGas ?? maxFeeFromProvider ?? gasPriceFallback;
  if (maxFeePerGas == null) throw new Error('provider returned no gas price data');

  const maxPriorityFeePerGas =
    overrides?.maxPriorityFeePerGas ?? maxPriorityFromProvider ?? maxFeePerGas;

  assertPriorityFeeBounds({ maxFeePerGas, maxPriorityFeePerGas });

  const gasPriceForBaseCost =
    overrides?.maxFeePerGas ?? maxFeeFromProvider ?? gasPriceFallback ?? maxFeePerGas;

  return {
    gasLimit: overrides?.gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasPriceForBaseCost,
  };
}

export async function getL2FeeOverrides(
  client: EthersClient,
  overrides?: Eip1559GasOverrides,
): Promise<ResolvedEip1559Fees> {
  assertNoLegacyGas(overrides);

  let maxFeeFromProvider: bigint | undefined;
  let maxPriorityFromProvider: bigint | undefined;
  let gasPriceFallback: bigint | undefined;
  try {
    const fd: FeeData = await client.l2.getFeeData();
    if (fd?.maxFeePerGas != null) maxFeeFromProvider = fd.maxFeePerGas;
    if (fd?.maxPriorityFeePerGas != null) {
      maxPriorityFromProvider = fd.maxPriorityFeePerGas;
    }
    if (fd?.gasPrice != null) gasPriceFallback = fd.gasPrice;
  } catch {
    // ignore
  }
  if (gasPriceFallback == null) {
    try {
      if (supportsGetGasPrice(client.l2)) {
        const gp = await client.l2.getGasPrice();
        gasPriceFallback = typeof gp === 'bigint' ? gp : BigInt(gp.toString());
      }
    } catch {
      // ignore
    }
  }

  const maxFeePerGas = overrides?.maxFeePerGas ?? maxFeeFromProvider ?? gasPriceFallback;
  if (maxFeePerGas == null) {
    throw new Error('L2 provider returned no gas price data');
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

// Fetches the gas price in wei
export async function getGasPriceWei(client: EthersClient): Promise<bigint> {
  // prefer FeeData.gasPrice if available; fallback to FeeData.maxFeePerGas
  const fd: FeeData = await client.l1.getFeeData();
  if (fd.gasPrice != null) return fd.gasPrice;
  if (fd.maxFeePerGas != null) return fd.maxFeePerGas;
  throw new Error('provider returned no gas price data');
}

// --- L2 request builders (ETH direct) ---
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
    l2Calldata: '0x',
    l2GasLimit: args.l2GasLimit,
    l2GasPerPubdataByteLimit: args.gasPerPubdata,
    factoryDeps: [] as `0x${string}`[],
    refundRecipient: args.refundRecipient,
  };
}

// --- Two-bridges encoding: generic tuple (token, amount, l2Receiver) ---
export function encodeSecondBridgeArgs(
  token: Address,
  amount: bigint,
  l2Receiver: Address,
): `0x${string}` {
  return AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'address'],
    [token, amount, l2Receiver],
  ) as `0x${string}`;
}

// --- Two-bridges encoding: ERC20 tuple (token, amount, l2Receiver) ---
export function encodeSecondBridgeErc20Args(
  token: Address,
  amount: bigint,
  l2Receiver: Address,
): `0x${string}` {
  return encodeSecondBridgeArgs(token, amount, l2Receiver);
}

// NEW: ETH-specific convenience (uses the ETH sentinel address)
export function encodeSecondBridgeEthArgs(
  amount: bigint,
  l2Receiver: Address,
  ethToken: Address = ETH_ADDRESS,
): `0x${string}` {
  return encodeSecondBridgeArgs(ethToken, amount, l2Receiver);
}
