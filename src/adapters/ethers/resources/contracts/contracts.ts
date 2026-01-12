// src/adapters/ethers/resources/contracts/contracts.ts

import type { EthersClient, ResolvedAddresses } from '../../client';
import type { ContractsResource, ContractInstances } from './types';

/**
 * Creates a contracts resource for managing resolved addresses and contract instances.
 *
 * @param client - EthersClient instance
 * @returns ContractsResource instance
 */
export function createContractsResource(client: EthersClient): ContractsResource {
  // -------------------------
  // Public API Implementation
  // -------------------------

  async function addresses(): Promise<ResolvedAddresses> {
    return client.ensureAddresses();
  }

  async function instances(): Promise<ContractInstances> {
    return client.contracts();
  }

  async function bridgehub() {
    const { bridgehub } = await instances();
    return bridgehub;
  }

  async function l1AssetRouter() {
    const { l1AssetRouter } = await instances();
    return l1AssetRouter;
  }

  async function l1NativeTokenVault() {
    const { l1NativeTokenVault } = await instances();
    return l1NativeTokenVault;
  }

  async function l1Nullifier() {
    const { l1Nullifier } = await instances();
    return l1Nullifier;
  }

  async function l2AssetRouter() {
    const { l2AssetRouter } = await instances();
    return l2AssetRouter;
  }

  async function l2NativeTokenVault() {
    const { l2NativeTokenVault } = await instances();
    return l2NativeTokenVault;
  }

  async function l2BaseTokenSystem() {
    const { l2BaseTokenSystem } = await instances();
    return l2BaseTokenSystem;
  }

  return {
    addresses,
    instances,
    bridgehub,
    l1AssetRouter,
    l1NativeTokenVault,
    l1Nullifier,
    l2AssetRouter,
    l2NativeTokenVault,
    l2BaseTokenSystem,
  };
}
