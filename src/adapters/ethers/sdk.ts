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
import { type Address, type Hex } from '../../core/types';
import { isAddressEq } from '../../core/utils/addr';
import { L2_BASE_TOKEN_ADDRESS, ETH_ADDRESS, FORMAL_ETH_ADDRESS } from '../../core/constants';

// SDK interface, combining deposits, withdrawals, and helpers
export interface EthersSdk {
  deposits: DepositsResourceType;
  withdrawals: WithdrawalsResourceType;
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
    l2TokenAddress(l1Token: Address): Promise<Address>;
    l1TokenAddress(l2Token: Address): Promise<Address>;
    assetId(l1Token: Address): Promise<Hex>;
  };
}

export function createEthersSdk(client: EthersClient): EthersSdk {
  return {
    deposits: createDepositsResource(client),
    withdrawals: createWithdrawalsResource(client),

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

      async l2TokenAddress(l1Token: Address): Promise<Address> {
        // ETH on L1 → contracts’ ETH placeholder on L2
        if (isAddressEq(l1Token, FORMAL_ETH_ADDRESS)) {
          return ETH_ADDRESS;
        }

        // Base token → L2 base-token system address
        const { chainId } = await client.l2.getNetwork();
        const base = await client.baseToken(BigInt(chainId));
        if (isAddressEq(l1Token, base)) {
          return L2_BASE_TOKEN_ADDRESS;
        }

        const { l2NativeTokenVault } = await client.contracts();
        // IL2NativeTokenVault.l2TokenAddress(address) → address
        const addr = (await l2NativeTokenVault.l2TokenAddress(l1Token)) as string;
        return addr as Address;
      },

      async l1TokenAddress(l2Token: Address): Promise<Address> {
        if (isAddressEq(l2Token, ETH_ADDRESS)) {
          return ETH_ADDRESS;
        }

        const { l2AssetRouter } = await client.contracts();
        // IL2AssetRouter.l1TokenAddress(address) → address
        const addr = (await l2AssetRouter.l1TokenAddress(l2Token)) as string;
        return addr as Address;
      },

      async assetId(l1Token: Address): Promise<Hex> {
        const norm = isAddressEq(l1Token, FORMAL_ETH_ADDRESS) ? ETH_ADDRESS : l1Token;

        const { l1NativeTokenVault } = await client.contracts();
        // IL1NativeTokenVault.assetId(address) → bytes32
        const id = (await l1NativeTokenVault.assetId(norm)) as string;
        return id as Hex;
      },
    },
  };
}
