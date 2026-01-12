// src/adapters/viem/resources/contracts/types.ts

import type { GetContractReturnType, PublicClient } from 'viem';
import type { ResolvedAddresses } from '../../client';
import type {
  IBridgehubABI,
  IL1AssetRouterABI,
  IL1NullifierABI,
  IL2AssetRouterABI,
  L2NativeTokenVaultABI,
  L1NativeTokenVaultABI,
  IBaseTokenABI,
} from '../../../../core/abi';

/**
 * Collection of typed viem contract instances for all bridge contracts.
 */
export interface ContractInstances {
  bridgehub: GetContractReturnType<typeof IBridgehubABI, PublicClient>;
  l1AssetRouter: GetContractReturnType<typeof IL1AssetRouterABI, PublicClient>;
  l1Nullifier: GetContractReturnType<typeof IL1NullifierABI, PublicClient>;
  l1NativeTokenVault: GetContractReturnType<typeof L1NativeTokenVaultABI, PublicClient>;
  l2AssetRouter: GetContractReturnType<typeof IL2AssetRouterABI, PublicClient>;
  l2NativeTokenVault: GetContractReturnType<typeof L2NativeTokenVaultABI, PublicClient>;
  l2BaseTokenSystem: GetContractReturnType<typeof IBaseTokenABI, PublicClient>;
}

/**
 * Contracts resource interface providing access to resolved addresses
 * and contract instances.
 */
export interface ContractsResource {
  /**
   * Returns resolved addresses for all bridge contracts.
   *
   * @returns Resolved contract addresses
   */
  addresses(): Promise<ResolvedAddresses>;

  /**
   * Returns typed contract instances for all bridge contracts (cached).
   *
   * @returns Contract instances
   */
  instances(): Promise<ContractInstances>;

  /**
   * Returns the Bridgehub contract instance.
   */
  bridgehub(): Promise<ContractInstances['bridgehub']>;

  /**
   * Returns the L1 Asset Router contract instance.
   */
  l1AssetRouter(): Promise<ContractInstances['l1AssetRouter']>;

  /**
   * Returns the L1 Native Token Vault contract instance.
   */
  l1NativeTokenVault(): Promise<ContractInstances['l1NativeTokenVault']>;

  /**
   * Returns the L1 Nullifier contract instance.
   */
  l1Nullifier(): Promise<ContractInstances['l1Nullifier']>;

  /**
   * Returns the L2 Asset Router contract instance.
   */
  l2AssetRouter(): Promise<ContractInstances['l2AssetRouter']>;

  /**
   * Returns the L2 Native Token Vault contract instance.
   */
  l2NativeTokenVault(): Promise<ContractInstances['l2NativeTokenVault']>;

  /**
   * Returns the L2 Base Token System contract instance.
   */
  l2BaseTokenSystem(): Promise<ContractInstances['l2BaseTokenSystem']>;
}
