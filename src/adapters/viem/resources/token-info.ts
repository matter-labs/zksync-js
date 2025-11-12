// src/adapters/viem/resources/token-info.ts

import type { Abi, PublicClient } from 'viem';
export type L2Reader = { readContract: PublicClient['readContract'] };

import type { Address } from '../../../core/types/primitives';
import { L2NativeTokenVaultABI } from '../../../core/internal/abi-registry';
import { encodeNativeTokenVaultAssetId } from '../resources/utils';
import {
  ETH_ADDRESS as ETH_ADDRESS_IN_CONTRACTS,
  L2_BASE_TOKEN_ADDRESS,
} from '../../../core/constants';

/**
 * Read the `BASE_TOKEN_ASSET_ID` from the L2 NativeTokenVault.
 * This is the encoded assetId of the chain’s base token.
 */
export async function ntvBaseAssetId(l2: L2Reader, ntv: Address) {
  return l2.readContract({
    address: ntv,
    abi: L2NativeTokenVaultABI as Abi,
    functionName: 'BASE_TOKEN_ASSET_ID',
  }) as Promise<`0x${string}`>;
}

/**
 * Read the `L1_CHAIN_ID` that the L2 NativeTokenVault is anchored to.
 * Needed when encoding asset IDs.
 */
export async function ntvL1ChainId(l2: L2Reader, ntv: Address) {
  return l2.readContract({
    address: ntv,
    abi: L2NativeTokenVaultABI as Abi,
    functionName: 'L1_CHAIN_ID',
  }) as Promise<bigint>;
}

/**
 * Ensure a token is registered in the L2 NativeTokenVault and return its assetId.
 * (Will register on-chain if not yet registered.)
 */
export async function ntvAssetIdForToken(l2: L2Reader, ntv: Address, token: Address) {
  return l2.readContract({
    address: ntv,
    abi: L2NativeTokenVaultABI as Abi,
    functionName: 'ensureTokenIsRegistered',
    args: [token],
  }) as Promise<`0x${string}`>;
}

/**
 * Check if the chain is ETH-based (i.e. base token == ETH).
 */
export async function isEthBasedChain(l2: L2Reader, ntv: Address): Promise<boolean> {
  const [baseAssetId, l1ChainId] = await Promise.all([
    ntvBaseAssetId(l2, ntv),
    ntvL1ChainId(l2, ntv),
  ]);
  const ethAssetId = encodeNativeTokenVaultAssetId(l1ChainId, ETH_ADDRESS_IN_CONTRACTS);
  return baseAssetId.toLowerCase() === ethAssetId.toLowerCase();
}

/**
 * Check if a given token address is the chain’s base token.
 */
export async function isBaseToken(l2: L2Reader, ntv: Address, token: Address): Promise<boolean> {
  const [baseAssetId, l1ChainId] = await Promise.all([
    ntvBaseAssetId(l2, ntv),
    ntvL1ChainId(l2, ntv),
  ]);
  const tokenAssetId = encodeNativeTokenVaultAssetId(l1ChainId, token);
  return baseAssetId.toLowerCase() === tokenAssetId.toLowerCase();
}

/**
 * Check if the token should be treated as "ETH" on this L2.
 * - If it equals the universal ETH alias (0x…800A), return true immediately.
 * - Else compare the token’s assetId to the ETH sentinel assetId via the NTV.
 */
export async function isEthTokenOnThisChain(
  l2: L2Reader,
  ntv: Address,
  token: Address,
): Promise<boolean> {
  // 0x…800A is L2_BASE_TOKEN_ADDRESS
  if (token.toLowerCase() === L2_BASE_TOKEN_ADDRESS.toLowerCase()) return true;

  const l1ChainId = await ntvL1ChainId(l2, ntv);
  const ethAssetId = encodeNativeTokenVaultAssetId(l1ChainId, ETH_ADDRESS_IN_CONTRACTS);
  const tokenAssetId = await ntvAssetIdForToken(l2, ntv, token);
  return tokenAssetId.toLowerCase() === ethAssetId.toLowerCase();
}
