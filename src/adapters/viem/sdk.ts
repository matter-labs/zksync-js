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
import {
  createTokensResource,
  type TokensResource as TokensResourceType,
} from './resources/tokens/index';

import type { Address } from '../../core/types';

// ABIs (to type contract handles returned from helpers.contracts())
import type {
  IBridgehubABI,
  IL1AssetRouterABI,
  IL1NullifierABI,
  IL2AssetRouterABI,
  L2NativeTokenVaultABI,
  L1NativeTokenVaultABI,
  IBaseTokenABI,
} from '../../core/abi';

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
  tokens: TokensResourceType;
  helpers: {
    // addresses & contracts
    addresses(): Promise<ResolvedAddresses>;
    contracts(): Promise<ViemContracts>;

    // common getters
    l1AssetRouter(): Promise<ViemContracts['l1AssetRouter']>;
    l1NativeTokenVault(): Promise<ViemContracts['l1NativeTokenVault']>;
    l1Nullifier(): Promise<ViemContracts['l1Nullifier']>;

    baseToken(chainId?: bigint): Promise<Address>;
  };
}

export function createViemSdk(client: ViemClient): ViemSdk {
  const tokens = createTokensResource(client);

  return {
    deposits: createDepositsResource(client, tokens),
    withdrawals: createWithdrawalsResource(client, tokens),
    tokens,

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
    },
  };
}
