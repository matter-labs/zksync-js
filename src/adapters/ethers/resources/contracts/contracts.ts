// src/adapters/ethers/resources/contracts/contracts.ts

import type { EthersClient } from '../../client';
import type { Address, Hex } from '../../../../core/types/primitives';
import type { ContractsResource, ContractInstances } from './types';
import type { ResolvedAddresses } from '../../client';
import { createErrorHandlers } from '../../errors/error-ops';

// Error handling for contracts resource
const { wrapAs } = createErrorHandlers('contracts');

/**
 * Creates a contracts resource for managing contract instances and
 * commonly-used read-only contract methods.
 *
 * @param client - EthersClient instance
 * @returns ContractsResource instance
 */
export function createContractsResource(client: EthersClient): ContractsResource {
  // Promise-based caching for immutable chain values
  let l2NtvL1ChainIdPromise: Promise<bigint> | null = null;
  let baseTokenAssetIdPromise: Promise<Hex> | null = null;
  let wethL1Promise: Promise<Address> | null = null;
  let wethL2Promise: Promise<Address> | null = null;

  /**
   * Gets the L1 chain ID from L2 NTV (cached)
   */
  async function getL2NtvL1ChainId(): Promise<bigint> {
    if (!l2NtvL1ChainIdPromise) {
      l2NtvL1ChainIdPromise = wrapAs('INTERNAL', 'contracts.getL2NtvL1ChainId', async () => {
        const { l2NativeTokenVault } = await client.contracts();
        const chainId = (await l2NativeTokenVault.L1_CHAIN_ID()) as bigint;
        return chainId;
      });
    }
    return l2NtvL1ChainIdPromise;
  }

  /**
   * Gets the base token assetId from L2 NTV (cached)
   */
  async function getBaseTokenAssetId(): Promise<Hex> {
    if (!baseTokenAssetIdPromise) {
      baseTokenAssetIdPromise = wrapAs('INTERNAL', 'contracts.getBaseTokenAssetId', async () => {
        const { l2NativeTokenVault } = await client.contracts();
        const assetId = (await l2NativeTokenVault.BASE_TOKEN_ASSET_ID()) as string;
        return assetId as Hex;
      });
    }
    return baseTokenAssetIdPromise;
  }

  /**
   * Gets WETH address on L1 (cached)
   */
  async function getWethL1(): Promise<Address> {
    if (!wethL1Promise) {
      wethL1Promise = wrapAs('INTERNAL', 'contracts.getWethL1', async () => {
        const { l1NativeTokenVault } = await client.contracts();
        const weth = (await l1NativeTokenVault.WETH_TOKEN()) as string;
        return weth as Address;
      });
    }
    return wethL1Promise;
  }

  /**
   * Gets WETH address on L2 (cached)
   */
  async function getWethL2(): Promise<Address> {
    if (!wethL2Promise) {
      wethL2Promise = wrapAs('INTERNAL', 'contracts.getWethL2', async () => {
        const { l2NativeTokenVault } = await client.contracts();
        const weth = (await l2NativeTokenVault.WETH_TOKEN()) as string;
        return weth as Address;
      });
    }
    return wethL2Promise;
  }

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

  // -------------------------
  // L1 Namespace
  // -------------------------

  const l1 = {
    async assetId(l1Token: Address): Promise<Hex> {
      return wrapAs(
        'CONTRACT',
        'contracts.l1.assetId',
        async () => {
          const { l1NativeTokenVault } = await instances();
          const assetId = (await l1NativeTokenVault.assetId(l1Token)) as string;
          return assetId as Hex;
        },
        {
          ctx: { l1Token },
          message: 'Failed to read L1 NTV assetId.',
        },
      );
    },

    async tokenAddress(assetId: Hex): Promise<Address> {
      return wrapAs(
        'CONTRACT',
        'contracts.l1.tokenAddress',
        async () => {
          const { l1NativeTokenVault } = await instances();
          const tokenAddr = (await l1NativeTokenVault.tokenAddress(assetId)) as string;
          return tokenAddr as Address;
        },
        {
          ctx: { assetId },
          message: 'Failed to read L1 NTV tokenAddress.',
        },
      );
    },

    async weth(): Promise<Address> {
      return getWethL1();
    },
  };

  // -------------------------
  // L2 Namespace
  // -------------------------

  const l2 = {
    async l1ChainId(): Promise<bigint> {
      return getL2NtvL1ChainId();
    },

    async baseTokenAssetId(): Promise<Hex> {
      return getBaseTokenAssetId();
    },

    async weth(): Promise<Address> {
      return getWethL2();
    },

    async assetId(l2Token: Address): Promise<Hex> {
      return wrapAs(
        'CONTRACT',
        'contracts.l2.assetId',
        async () => {
          const { l2NativeTokenVault } = await instances();
          const assetId = (await l2NativeTokenVault.assetId(l2Token)) as string;
          return assetId as Hex;
        },
        {
          ctx: { l2Token },
          message: 'Failed to read L2 NTV assetId.',
        },
      );
    },

    async tokenAddress(assetId: Hex): Promise<Address> {
      return wrapAs(
        'CONTRACT',
        'contracts.l2.tokenAddress',
        async () => {
          const { l2NativeTokenVault } = await instances();
          const tokenAddr = (await l2NativeTokenVault.tokenAddress(assetId)) as string;
          return tokenAddr as Address;
        },
        {
          ctx: { assetId },
          message: 'Failed to read L2 NTV tokenAddress.',
        },
      );
    },

    async originChainId(assetId: Hex): Promise<bigint> {
      return wrapAs(
        'CONTRACT',
        'contracts.l2.originChainId',
        async () => {
          const { l2NativeTokenVault } = await instances();
          const chainId = (await l2NativeTokenVault.originChainId(assetId)) as bigint;
          return chainId;
        },
        {
          ctx: { assetId },
          message: 'Failed to read L2 NTV originChainId.',
        },
      );
    },

    async l2TokenAddress(l1Token: Address): Promise<Address> {
      return wrapAs(
        'CONTRACT',
        'contracts.l2.l2TokenAddress',
        async () => {
          const { l2NativeTokenVault } = await instances();
          const l2Token = (await l2NativeTokenVault.l2TokenAddress(l1Token)) as string;
          return l2Token as Address;
        },
        {
          ctx: { l1Token },
          message: 'Failed to read L2 NTV l2TokenAddress.',
        },
      );
    },

    async predictBridgedTokenAddress(args: {
      originChainId: bigint;
      l1Token: Address;
    }): Promise<Address> {
      return wrapAs(
        'CONTRACT',
        'contracts.l2.predictBridgedTokenAddress',
        async () => {
          const { l2NativeTokenVault } = await instances();
          const predicted = (await l2NativeTokenVault.calculateCreate2TokenAddress(
            args.originChainId,
            args.l1Token,
          )) as string;
          return predicted as Address;
        },
        {
          ctx: args,
          message: 'Failed to predict L2 bridged token address.',
        },
      );
    },
  };

  // -------------------------
  // Router Namespace
  // -------------------------

  const router = {
    async l1TokenAddress(l2Token: Address): Promise<Address> {
      return wrapAs(
        'CONTRACT',
        'contracts.router.l1TokenAddress',
        async () => {
          const { l2AssetRouter } = await instances();
          const l1Token = (await l2AssetRouter.l1TokenAddress(l2Token)) as string;
          return l1Token as Address;
        },
        {
          ctx: { l2Token },
          message: 'Failed to read L2 AssetRouter l1TokenAddress.',
        },
      );
    },

    async l2TokenAddress(l1Token: Address): Promise<Address> {
      return wrapAs(
        'CONTRACT',
        'contracts.router.l2TokenAddress',
        async () => {
          const { l2AssetRouter } = await instances();
          const l2Token = (await l2AssetRouter.l2TokenAddress(l1Token)) as string;
          return l2Token as Address;
        },
        {
          ctx: { l1Token },
          message: 'Failed to read L2 AssetRouter l2TokenAddress.',
        },
      );
    },

    async assetHandlerAddress(assetId: Hex): Promise<Address> {
      return wrapAs(
        'CONTRACT',
        'contracts.router.assetHandlerAddress',
        async () => {
          const { l2AssetRouter } = await instances();
          const handler = (await l2AssetRouter.assetHandlerAddress(assetId)) as string;
          return handler as Address;
        },
        {
          ctx: { assetId },
          message: 'Failed to read L2 AssetRouter assetHandlerAddress.',
        },
      );
    },
  };

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
    l1,
    l2,
    router,
  };
}
