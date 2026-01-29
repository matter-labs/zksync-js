import { AbiCoder } from 'ethers';
import type { Address, Hex } from '../../../core/types';
import { ETH_ADDRESS } from '../../../core/constants';
import { createBridgeCodec } from '../../../core/codec/bridge';
import { buildDirectRequestStruct as buildDirectRequestStructCore } from '../../../core/resources/deposits/structs';

// Encoding utilities for deposit/withdrawal data
// Note: AssetId encoding is now handled via sdk.tokens or core/codec/ntv.ts

const coder = AbiCoder.defaultAbiCoder();
const bridgeCodec = createBridgeCodec({
  encode: (types: string[], values: unknown[]) =>
    coder.encode(types, values) as Hex,
});

// Encodes the data for a transfer of a token through the Native Token Vault
export function encodeNativeTokenVaultTransferData(
  amount: bigint,
  receiver: Address,
  token: Address,
) {
  return bridgeCodec.encodeNativeTokenVaultTransferData(amount, receiver, token);
}

// Encodes the data for a second bridge transfer
export function encodeSecondBridgeDataV1(assetId: string, transferData: string) {
  return bridgeCodec.encodeSecondBridgeDataV1(assetId as Hex, transferData as Hex);
}

// --- Two-bridges encoding: generic tuple (token, amount, l2Receiver) ---
export function encodeSecondBridgeArgs(
  token: Address,
  amount: bigint,
  l2Receiver: Address,
): `0x${string}` {
  return bridgeCodec.encodeSecondBridgeArgs(token, amount, l2Receiver);
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
  return bridgeCodec.encodeSecondBridgeEthArgs(amount, l2Receiver, ethToken);
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
  return buildDirectRequestStructCore(args);
}
