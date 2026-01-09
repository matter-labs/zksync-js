// src/adapters/ethers/resources/contracts/types.ts

import type { Contract } from 'ethers';
import type { Address, Hex } from '../../../../core/types/primitives';
import type { ResolvedAddresses } from '../../client';

/**
 * Collection of typed ethers Contract instances for all bridge contracts.
 */
export interface ContractInstances {
  bridgehub: Contract;
  l1AssetRouter: Contract;
  l1Nullifier: Contract;
  l1NativeTokenVault: Contract;
  l2AssetRouter: Contract;
  l2NativeTokenVault: Contract;
  l2BaseTokenSystem: Contract;
}

/**
 * Contracts resource interface providing access to resolved addresses,
 * contract instances, and commonly-used read-only contract methods.
 */
export interface ContractsResource {
  // -------------------------
  // Addresses & Instances
  // -------------------------

  /**
   * Returns resolved addresses for all bridge contracts.
   *
   * @returns Resolved contract addresses
   */
  addresses(): Promise<ResolvedAddresses>;

  /**
   * Returns typed Contract instances for all bridge contracts (cached).
   *
   * @returns Contract instances
   */
  instances(): Promise<ContractInstances>;

  // -------------------------
  // Individual Contract Getters
  // -------------------------

  /**
   * Returns the Bridgehub contract instance.
   */
  bridgehub(): Promise<Contract>;

  /**
   * Returns the L1 Asset Router contract instance.
   */
  l1AssetRouter(): Promise<Contract>;

  /**
   * Returns the L1 Native Token Vault contract instance.
   */
  l1NativeTokenVault(): Promise<Contract>;

  /**
   * Returns the L1 Nullifier contract instance.
   */
  l1Nullifier(): Promise<Contract>;

  /**
   * Returns the L2 Asset Router contract instance.
   */
  l2AssetRouter(): Promise<Contract>;

  /**
   * Returns the L2 Native Token Vault contract instance.
   */
  l2NativeTokenVault(): Promise<Contract>;

  /**
   * Returns the L2 Base Token System contract instance.
   */
  l2BaseTokenSystem(): Promise<Contract>;

  // -------------------------
  // L1 Native Token Vault Reads
  // -------------------------

  /**
   * L1 Native Token Vault read-only methods.
   */
  l1: {
    /**
     * Computes the assetId for a given L1 token.
     *
     * @param l1Token - L1 token address
     * @returns AssetId (bytes32)
     */
    assetId(l1Token: Address): Promise<Hex>;

    /**
     * Retrieves the token address for a given assetId.
     *
     * @param assetId - Asset ID (bytes32)
     * @returns L1 token address
     */
    tokenAddress(assetId: Hex): Promise<Address>;

    /**
     * Returns the WETH token address on L1 (cached).
     *
     * @returns WETH L1 address
     */
    weth(): Promise<Address>;
  };

  // -------------------------
  // L2 Native Token Vault Reads
  // -------------------------

  /**
   * L2 Native Token Vault read-only methods.
   */
  l2: {
    /**
     * Returns the L1 chain ID (cached).
     *
     * @returns L1 chain ID
     */
    l1ChainId(): Promise<bigint>;

    /**
     * Returns the base token assetId (cached).
     *
     * @returns Base token assetId (bytes32)
     */
    baseTokenAssetId(): Promise<Hex>;

    /**
     * Returns the WETH token address on L2 (cached).
     *
     * @returns WETH L2 address
     */
    weth(): Promise<Address>;

    /**
     * Computes the assetId for a given L2 token.
     *
     * @param l2Token - L2 token address
     * @returns AssetId (bytes32)
     */
    assetId(l2Token: Address): Promise<Hex>;

    /**
     * Retrieves the token address for a given assetId.
     *
     * @param assetId - Asset ID (bytes32)
     * @returns L2 token address
     */
    tokenAddress(assetId: Hex): Promise<Address>;

    /**
     * Retrieves the origin chain ID for a given assetId.
     *
     * @param assetId - Asset ID (bytes32)
     * @returns Origin chain ID
     */
    originChainId(assetId: Hex): Promise<bigint>;

    /**
     * Returns the L2 token address for a given L1 token.
     *
     * @param l1Token - L1 token address
     * @returns L2 token address
     */
    l2TokenAddress(l1Token: Address): Promise<Address>;

    /**
     * Predicts the L2 address for a bridged token given its origin chain and L1 address.
     * This uses the CREATE2 deterministic deployment address calculation.
     *
     * @param args - Origin chain ID and L1 token address
     * @returns Predicted L2 token address
     */
    predictBridgedTokenAddress(args: { originChainId: bigint; l1Token: Address }): Promise<Address>;
  };

  // -------------------------
  // L2 Asset Router Reads
  // -------------------------

  /**
   * L2 Asset Router read-only methods.
   */
  router: {
    /**
     * Returns the L1 token address for a given L2 token.
     *
     * @param l2Token - L2 token address
     * @returns L1 token address
     */
    l1TokenAddress(l2Token: Address): Promise<Address>;

    /**
     * Returns the L2 token address for a given L1 token.
     *
     * @param l1Token - L1 token address
     * @returns L2 token address
     */
    l2TokenAddress(l1Token: Address): Promise<Address>;

    /**
     * Returns the asset handler address for a given assetId.
     * (Advanced/debug utility)
     *
     * @param assetId - Asset ID (bytes32)
     * @returns Asset handler address
     */
    assetHandlerAddress(assetId: Hex): Promise<Address>;
  };
}
