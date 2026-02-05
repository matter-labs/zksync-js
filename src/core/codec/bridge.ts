// core/codec/bridge.ts

import type { Address, Hex } from '../types/primitives';
import { ETH_ADDRESS } from '../constants';

export interface BridgeCodecDeps {
  /**
   * ABI encoder: (types, values) => encoded hex string
   * For ethers: AbiCoder.encode
   * For viem: encodeAbiParameters
   */
  encode(types: string[], values: unknown[]): Hex;
}

export function createBridgeCodec(deps: BridgeCodecDeps) {
  function encodeNativeTokenVaultTransferData(
    amount: bigint,
    receiver: Address,
    token: Address,
  ): Hex {
    return deps.encode(['uint256', 'address', 'address'], [amount, receiver, token]);
  }

  function encodeSecondBridgeDataV1(assetId: Hex, transferData: Hex): Hex {
    const data = deps.encode(['bytes32', 'bytes'], [assetId, transferData]);
    return `0x01${data.slice(2)}` as Hex;
  }

  function encodeSecondBridgeArgs(token: Address, amount: bigint, l2Receiver: Address): Hex {
    return deps.encode(['address', 'uint256', 'address'], [token, amount, l2Receiver]);
  }

  function encodeSecondBridgeErc20Args(token: Address, amount: bigint, l2Receiver: Address): Hex {
    return encodeSecondBridgeArgs(token, amount, l2Receiver);
  }

  function encodeSecondBridgeEthArgs(
    amount: bigint,
    l2Receiver: Address,
    ethToken: Address = ETH_ADDRESS,
  ): Hex {
    return encodeSecondBridgeArgs(ethToken, amount, l2Receiver);
  }

  return {
    encodeNativeTokenVaultTransferData,
    encodeSecondBridgeDataV1,
    encodeSecondBridgeArgs,
    encodeSecondBridgeErc20Args,
    encodeSecondBridgeEthArgs,
  };
}
