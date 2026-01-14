// src/adapters/ethers/resources/contracts/types.ts

import type { Contract } from 'ethers';
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
  interopCenter: Contract;
  interopHandler: Contract;
  l2MessageVerification: Contract;
}

/**
 * Contracts resource interface providing access to resolved addresses
 * and contract instances.
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

  /**
   * Returns the Interop Center contract instance.
   */
  interopCenter(): Promise<Contract>;

  /**
   * Returns the Interop Handler contract instance.
   */
  interopHandler(): Promise<Contract>;

  /**
   * Returns the L2 Message Verification contract instance.
   */
  l2MessageVerification(): Promise<Contract>;
}
