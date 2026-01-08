// src/adapters/ethers/sdk.ts
import type { Contract } from 'ethers';
import type { EthersClient, ResolvedAddresses } from './client';
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
} from './resources/tokens/index';
import type { TokensResource as TokensResourceType } from '../../core/types/flows/token';
import { type Address } from '../../core/types';

// SDK interface, combining deposits, withdrawals, and helpers
export interface EthersSdk {
  deposits: DepositsResourceType;
  withdrawals: WithdrawalsResourceType;
  tokens: TokensResourceType;
  helpers: {
    // addresses & contracts
    addresses(): Promise<ResolvedAddresses>;
    contracts(): Promise<{
      bridgehub: Contract;
      l1AssetRouter: Contract;
      l1Nullifier: Contract;
      l1NativeTokenVault: Contract;
      l2AssetRouter: Contract;
      l2NativeTokenVault: Contract;
      l2BaseTokenSystem: Contract;
    }>;

    // common getters
    l1AssetRouter(): Promise<Contract>;
    l1NativeTokenVault(): Promise<Contract>;
    l1Nullifier(): Promise<Contract>;
    baseToken(chainId?: bigint): Promise<Address>;
  };
}

export function createEthersSdk(client: EthersClient): EthersSdk {
  const tokens = createTokensResource(client);

  return {
    deposits: createDepositsResource(client, tokens),
    withdrawals: createWithdrawalsResource(client, tokens),
    tokens,

    // TODO: might update to create dedicated resources for these
    helpers: {
      addresses: () => client.ensureAddresses(),
      contracts: () => client.contracts(),

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
        const id = chainId ?? BigInt((await client.l2.getNetwork()).chainId);
        return client.baseToken(id);
      },
    },
  };
}
