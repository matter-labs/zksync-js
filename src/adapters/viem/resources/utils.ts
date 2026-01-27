// src/adapters/viem/resources/utils.ts
import { encodeAbiParameters, type Hex } from 'viem';
import type { Address } from '../../../core/types';
import { ETH_ADDRESS } from '../../../core/constants';
import { createBridgeCodec } from '../../../core/codec/bridge';
import { buildDirectRequestStruct as buildDirectRequestStructCore } from '../../../core/resources/deposits/structs';

/* -----------------------------------------------------------------------------
 * Encoding utilities for deposit/withdrawal data
 * Note: AssetId encoding is now handled via sdk.tokens or core/codec/ntv.ts
 * ---------------------------------------------------------------------------*/

const bridgeCodec = createBridgeCodec({
  encode: (types: string[], values: unknown[]) =>
    encodeAbiParameters(
      types.map((t: string, i: number) => ({ type: t, name: `arg${i}` })),
      values,
    ),
});

// Encodes the data for a transfer of a token through the Native Token Vault
export function encodeNativeTokenVaultTransferData(
  amount: bigint,
  receiver: Address,
  token: Address,
): Hex {
  return bridgeCodec.encodeNativeTokenVaultTransferData(amount, receiver, token);
}

// Encodes the data for a second bridge transfer (V1)
export function encodeSecondBridgeDataV1(assetId: Hex, transferData: Hex): Hex {
  return bridgeCodec.encodeSecondBridgeDataV1(assetId, transferData);
}

/* -----------------------------------------------------------------------------
 * Two-bridges encoding: generic tuple (token, amount, l2Receiver)
 * ---------------------------------------------------------------------------*/
export function encodeSecondBridgeArgs(token: Address, amount: bigint, l2Receiver: Address): Hex {
  return bridgeCodec.encodeSecondBridgeArgs(token, amount, l2Receiver);
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
  return bridgeCodec.encodeSecondBridgeEthArgs(amount, l2Receiver, ethToken);
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
  return buildDirectRequestStructCore(args);
}
