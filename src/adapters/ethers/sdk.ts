// src/adapters/ethers/sdk.ts
import type { EthersClient } from './client';
import { createDepositsResource, type DepositsResource } from './resources/deposits/index';
import { createWithdrawalsResource, type WithdrawalsResource } from './resources/withdrawals/index';
import { createInteropResource, type InteropResource } from './resources/interop/index';
import { createTokensResource } from './resources/tokens/index';
import type { TokensResource } from '../../core/types/flows/token';
import type { ContractsResource } from './resources/contracts/index';
import { createContractsResource } from './resources/contracts/index';
import type { InteropConfig } from './resources/interop/types';

export interface EthersSdkOptions {
  /** Configuration required for interop operations. */
  interop?: InteropConfig;
}

// SDK interface, combining deposits, withdrawals, tokens, contracts, and interop
export interface EthersSdk {
  deposits: DepositsResource;
  withdrawals: WithdrawalsResource;
  tokens: TokensResource;
  contracts: ContractsResource;
  interop: InteropResource;
}

export function createEthersSdk(client: EthersClient, options?: EthersSdkOptions): EthersSdk {
  const tokens = createTokensResource(client);
  const contracts = createContractsResource(client);
  const interop = createInteropResource(client, options?.interop, tokens, contracts);

  return {
    deposits: createDepositsResource(client, tokens, contracts),
    withdrawals: createWithdrawalsResource(client, tokens, contracts),
    tokens,
    contracts,
    interop,
  };
}
