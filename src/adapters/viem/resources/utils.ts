// src/adapters/viem/resources/utils.ts
import { encodeAbiParameters, concat, type Hex } from 'viem';
import type { Address } from '../../../core/types';
import { ETH_ADDRESS } from '../../../core/constants';

/* -----------------------------------------------------------------------------
 * Encoding utilities for deposit/withdrawal data
 * Note: AssetId encoding is now handled via sdk.tokens or core/codec/ntv.ts
 * ---------------------------------------------------------------------------*/

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
