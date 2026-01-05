// src/adapters/ethers/resources/tokens/types.ts

import type { Address, Hex } from '../../../../core/types/primitives';

// TODO: add links to source code from contracts

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
  /**
   * Token kind: 'eth', 'base', or 'erc20'
   */
  kind: TokenKind;

  /**
   * Canonical L1 token address
   */
  l1: Address;

  /**
   * Canonical L2 token address
   */
  l2: Address;

  /**
   * Bridge asset ID (bytes32)
   */
  assetId: Hex;

  /**
   * Chain ID where this token originates
   */
  originChainId: bigint;

  /**
   * Whether the L2 chain is ETH-based (i.e., base token is ETH)
   */
  isChainEthBased: boolean;

  /**
   * Asset ID of the chain's base token
   */
  baseTokenAssetId: Hex;

  /**
   * WETH address on L1
   */
  wethL1: Address;

  /**
   * WETH address on L2
   */
  wethL2: Address;
}

/**
 * Tokens resource interface providing token identity, L1/L2 mapping,
 * and bridge assetId primitives.
 */
export interface TokensResource {
  /**
   * Resolves a token reference into a complete `ResolvedToken` with all
   * L1/L2 addresses, assetId, origin chain, and chain facts.
   *
   * @param ref - Token address or TokenRef object
   * @param opts - Optional chain specification when ref is an Address
   * @returns Fully resolved token information
   *
   * @example
   * ```typescript
   * // Resolve by L1 address (default)
   * const token = await sdk.tokens.resolve('0x...');
   *
   * // Explicitly specify chain
   * const token = await sdk.tokens.resolve('0x...', { chain: 'l2' });
   *
   * // Use TokenRef object
   * const token = await sdk.tokens.resolve({ chain: 'l1', address: '0x...' });
   * ```
   */
  resolve(ref: Address | TokenRef, opts?: { chain?: 'l1' | 'l2' }): Promise<ResolvedToken>;

  // -------------------------
  // L1 <-> L2 Mapping
  // -------------------------

  /**
   * Maps an L1 token address to its corresponding L2 token address.
   *
   * @param l1Token - L1 token address
   * @returns Corresponding L2 token address
   *
   * @example
   * ```typescript
   * const l2Token = await sdk.tokens.toL2Address('0x...L1Address');
   * ```
   */
  toL2Address(l1Token: Address): Promise<Address>;

  /**
   * Maps an L2 token address to its corresponding L1 token address.
   *
   * @param l2Token - L2 token address
   * @returns Corresponding L1 token address
   *
   * @example
   * ```typescript
   * const l1Token = await sdk.tokens.toL1Address('0x...L2Address');
   * ```
   */
  toL1Address(l2Token: Address): Promise<Address>;

  // -------------------------
  // Bridge Identity Primitives
  // -------------------------

  /**
   * Computes the bridge assetId for a given L1 token address.
   *
   * @param l1Token - L1 token address
   * @returns AssetId (bytes32)
   */
  assetIdOfL1(l1Token: Address): Promise<Hex>;

  /**
   * Computes the bridge assetId for a given L2 token address.
   *
   * @param l2Token - L2 token address
   * @returns AssetId (bytes32)
   */
  assetIdOfL2(l2Token: Address): Promise<Hex>;

  /**
   * Retrieves the L2 token address for a given assetId.
   *
   * @param assetId - Bridge asset ID (bytes32)
   * @returns L2 token address
   */
  l2TokenFromAssetId(assetId: Hex): Promise<Address>;

  /**
   * Retrieves the L1 token address for a given assetId.
   *
   * @param assetId - Bridge asset ID (bytes32)
   * @returns L1 token address
   */
  l1TokenFromAssetId(assetId: Hex): Promise<Address>;

  /**
   * Retrieves the origin chain ID for a given assetId.
   *
   * @param assetId - Bridge asset ID (bytes32)
   * @returns Origin chain ID
   */
  originChainId(assetId: Hex): Promise<bigint>;

  // -------------------------
  // Chain Token Facts
  // -------------------------

  /**
   * Returns the assetId of the base token for the L2 chain.
   *
   * @returns Base token assetId (bytes32)
   */
  baseTokenAssetId(): Promise<Hex>;

  /**
   * Determines whether the L2 chain is ETH-based (i.e., base token is ETH).
   *
   * @returns True if the chain is ETH-based, false otherwise
   */
  isChainEthBased(): Promise<boolean>;

  /**
   * Returns the WETH token address on L1.
   *
   * @returns WETH L1 address
   */
  wethL1(): Promise<Address>;

  /**
   * Returns the WETH token address on L2.
   *
   * @returns WETH L2 address
   */
  wethL2(): Promise<Address>;

  // -------------------------
  // Computed Addresses
  // -------------------------

  /**
   * Predicts the L2 address for a bridged token given its origin chain and L1 address.
   * This uses the CREATE2 deterministic deployment address calculation.
   *
   * @param args - Origin chain ID and L1 token address
   * @returns Predicted L2 token address
   *
   * @example
   * ```typescript
   * const predictedL2Addr = await sdk.tokens.computeL2BridgedAddress({
   *   originChainId: 1n,
   *   l1Token: '0x...'
   * });
   * ```
   */
  computeL2BridgedAddress(args: { originChainId: bigint; l1Token: Address }): Promise<Address>;
}
