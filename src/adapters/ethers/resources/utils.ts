import { AbiCoder, ethers } from 'ethers';
import type { Address } from '../../../core/types';
import { L2_NATIVE_TOKEN_VAULT_ADDRESS, ETH_ADDRESS } from '../../../core/constants';

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

export const encodeNTVTransferData = encodeNativeTokenVaultTransferData;

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
