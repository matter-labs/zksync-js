// src/adapters/ethers/resources/token-info.ts

import { Contract, type Provider } from 'ethers';
import type { Address } from '../../../core/types/primitives';
import { L2NativeTokenVaultABI } from '../../../core/internal/abi-registry';
import { encodeNativeTokenVaultAssetId } from '../resources/utils'; // ethers version
import {
  ETH_ADDRESS as ETH_ADDRESS_IN_CONTRACTS,
  L2_BASE_TOKEN_ADDRESS,
} from '../../../core/constants';

/**
 * Read the `BASE_TOKEN_ASSET_ID` from the L2 NativeTokenVault.
 * This is the encoded assetId of the chain’s base token.
 */
export async function ntvBaseAssetId(l2: Provider, ntv: Address) {
  const c = new Contract(ntv, L2NativeTokenVaultABI, l2);
  return (await c.BASE_TOKEN_ASSET_ID()) as `0x${string}`;
}
/**
 * Read the `L1_CHAIN_ID` that the L2 NativeTokenVault is anchored to.
 * Needed when encoding asset IDs.
 */
export async function ntvL1ChainId(l2: Provider, ntv: Address) {
  const c = new Contract(ntv, L2NativeTokenVaultABI, l2);
  return (await c.L1_CHAIN_ID()) as bigint;
}

/**
 * Ensure a token is registered in the L2 NativeTokenVault and return its assetId.
 * (Will register on-chain if not yet registered.)
 */
export async function ntvAssetIdForToken(l2: Provider, ntv: Address, token: Address) {
  const c = new Contract(ntv, L2NativeTokenVaultABI, l2);
  return (await c.ensureTokenIsRegistered(token)) as `0x${string}`;
}

/**
 * Check if the chain is ETH-based (i.e. base token == ETH).
 */
export async function isEthBasedChain(l2: Provider, ntv: Address): Promise<boolean> {
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
export async function isBaseToken(l2: Provider, ntv: Address, token: Address): Promise<boolean> {
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
  l2: Provider,
  ntv: Address,
  token: Address,
): Promise<boolean> {
  if (token.toLowerCase() === L2_BASE_TOKEN_ADDRESS.toLowerCase()) return true;

  const [l1ChainId, tokenAssetId] = await Promise.all([
    ntvL1ChainId(l2, ntv),
    ntvAssetIdForToken(l2, ntv, token),
  ]);
  const ethAssetId = encodeNativeTokenVaultAssetId(l1ChainId, ETH_ADDRESS_IN_CONTRACTS);
  return tokenAssetId.toLowerCase() === ethAssetId.toLowerCase();
}
