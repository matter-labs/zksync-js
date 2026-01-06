// src/adapters/viem/resources/tokens/types.ts

import type { Address, Hex } from '../../../../core/types/primitives';

/**
 * Token kind classification.
 * - 'eth': Ethereum / native ETH token
 * - 'base': The base token of the target L2 chain
 * - 'erc20': ERC-20 token
 */
export type TokenKind = 'eth' | 'base' | 'erc20';

/**
 * Reference to a token on a specific chain.
 * Used as input to identify a token for resolution.
 */
export type TokenRef = { chain: 'l1'; address: Address } | { chain: 'l2'; address: Address };

/**
 * Fully resolved token information including L1/L2 addresses,
 * bridge identity, and chain-specific facts.
 */
export interface ResolvedToken {
  kind: TokenKind;
  l1: Address;
  l2: Address;
  assetId: Hex;
  originChainId: bigint;
  isChainEthBased: boolean;
  baseTokenAssetId: Hex;
  wethL1: Address;
  wethL2: Address;
}

/**
 * Tokens resource interface providing token identity, L1/L2 mapping,
 * and bridge assetId primitives.
 */
export interface TokensResource {
  resolve(ref: Address | TokenRef, opts?: { chain?: 'l1' | 'l2' }): Promise<ResolvedToken>;

  toL2Address(l1Token: Address): Promise<Address>;
  toL1Address(l2Token: Address): Promise<Address>;

  assetIdOfL1(l1Token: Address): Promise<Hex>;
  assetIdOfL2(l2Token: Address): Promise<Hex>;
  l2TokenFromAssetId(assetId: Hex): Promise<Address>;
  l1TokenFromAssetId(assetId: Hex): Promise<Address>;
  originChainId(assetId: Hex): Promise<bigint>;

  baseTokenAssetId(): Promise<Hex>;
  isChainEthBased(): Promise<boolean>;
  wethL1(): Promise<Address>;
  wethL2(): Promise<Address>;

  computeL2BridgedAddress(args: { originChainId: bigint; l1Token: Address }): Promise<Address>;
}
