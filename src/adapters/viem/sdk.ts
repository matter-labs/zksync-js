// src/adapters/viem/sdk.ts
import type { PublicClient, GetContractReturnType } from 'viem';
import type { ViemClient, ResolvedAddresses } from './client';

import {
  createDepositsResource,
  type DepositsResource as DepositsResourceType,
} from './resources/deposits/index';

import {
  createWithdrawalsResource,
  type WithdrawalsResource as WithdrawalsResourceType,
} from './resources/withdrawals/index';

import type { Address, Hex } from '../../core/types';
import { isAddressEq } from '../../core/utils/addr';
import { L2_BASE_TOKEN_ADDRESS, ETH_ADDRESS, FORMAL_ETH_ADDRESS } from '../../core/constants';

// ABIs (to type contract handles returned from helpers.contracts())
import type {
  IBridgehubABI,
  IL1AssetRouterABI,
  IL1NullifierABI,
  IL2AssetRouterABI,
  L2NativeTokenVaultABI,
  L1NativeTokenVaultABI,
  IBaseTokenABI,
} from '../../core/internal/abi-registry';

// Helpers to express the contracts() return type
type ViemContracts = {
  bridgehub: GetContractReturnType<typeof IBridgehubABI, PublicClient>;
  l1AssetRouter: GetContractReturnType<typeof IL1AssetRouterABI, PublicClient>;
  l1Nullifier: GetContractReturnType<typeof IL1NullifierABI, PublicClient>;
  l1NativeTokenVault: GetContractReturnType<typeof L1NativeTokenVaultABI, PublicClient>;
  l2AssetRouter: GetContractReturnType<typeof IL2AssetRouterABI, PublicClient>;
  l2NativeTokenVault: GetContractReturnType<typeof L2NativeTokenVaultABI, PublicClient>;
  l2BaseTokenSystem: GetContractReturnType<typeof IBaseTokenABI, PublicClient>;
};

// Main SDK interface (Viem)
export interface ViemSdk {
  deposits: DepositsResourceType;
  withdrawals: WithdrawalsResourceType;
  helpers: {
    // addresses & contracts
    addresses(): Promise<ResolvedAddresses>;
    contracts(): Promise<ViemContracts>;

    // common getters
    l1AssetRouter(): Promise<ViemContracts['l1AssetRouter']>;
    l1NativeTokenVault(): Promise<ViemContracts['l1NativeTokenVault']>;
    l1Nullifier(): Promise<ViemContracts['l1Nullifier']>;

    baseToken(chainId?: bigint): Promise<Address>;
    l2TokenAddress(l1Token: Address): Promise<Address>;
    l1TokenAddress(l2Token: Address): Promise<Address>;
    assetId(l1Token: Address): Promise<Hex>;
  };
}

export function createViemSdk(client: ViemClient): ViemSdk {
  return {
    deposits: createDepositsResource(client),
    withdrawals: createWithdrawalsResource(client),

    helpers: {
      addresses: () => client.ensureAddresses(),
      contracts: () => client.contracts() as Promise<ViemContracts>,

      async l1AssetRouter() {
        const { l1AssetRouter } = await client.contracts();
        return l1AssetRouter;
      },
      async l1NativeTokenVault() {
        const { l1NativeTokenVault } = await client.contracts();
        return l1NativeTokenVault;
      },
      async l1Nullifier() {
        const { l1Nullifier } = await client.contracts();
        return l1Nullifier;
      },

      async baseToken(chainId?: bigint) {
        const id = chainId ?? BigInt(await client.l2.getChainId());
        return client.baseToken(id);
      },

      async l2TokenAddress(l1Token: Address): Promise<Address> {
        // ETH on L1 → contracts’ ETH placeholder on L2
        if (isAddressEq(l1Token, FORMAL_ETH_ADDRESS)) {
          return ETH_ADDRESS;
        }

        // Base token → L2 base-token system address
        const base = await client.baseToken(BigInt(await client.l2.getChainId()));
        if (isAddressEq(l1Token, base)) {
          return L2_BASE_TOKEN_ADDRESS;
        }

        // Lookup via L2 Native Token Vault
        const { l2NativeTokenVault } = await client.contracts();
        const addr = await l2NativeTokenVault.read.l2TokenAddress([l1Token]);
        return addr;
      },

      async l1TokenAddress(l2Token: Address): Promise<Address> {
        if (isAddressEq(l2Token, FORMAL_ETH_ADDRESS)) {
          return FORMAL_ETH_ADDRESS;
        }

        const { l2AssetRouter } = await client.contracts();
        const addr = await l2AssetRouter.read.l1TokenAddress([l2Token]);
        return addr;
      },

      async assetId(l1Token: Address): Promise<Hex> {
        // Normalize ETH → contracts placeholder
        const norm = isAddressEq(l1Token, FORMAL_ETH_ADDRESS) ? ETH_ADDRESS : l1Token;

        const { l1NativeTokenVault } = await client.contracts();
        const id = await l1NativeTokenVault.read.assetId([norm]);
        return id;
      },
    },
  };
}
