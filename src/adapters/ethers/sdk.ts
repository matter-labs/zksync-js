// src/adapters/ethers/sdk.ts
import type { EthersClient } from './client';
import {
  createDepositsResource,
  type DepositsResource as DepositsResourceType,
} from './resources/deposits/index';
import {
  createWithdrawalsResource,
  type WithdrawalsResource as WithdrawalsResourceType,
} from './resources/withdrawals/index';
import {
  createInteropResource,
  type InteropResource as InteropResourceType,
} from './resources/interop/index';
import { createTokensResource } from './resources/tokens/index';
import type { TokensResource as TokensResourceType } from '../../core/types/flows/token';
import type { ContractsResource as ContractsResourceType } from './resources/contracts/index';
import { createContractsResource } from './resources/contracts/index';

// SDK interface, combining deposits, withdrawals, tokens, contracts, and interop
export interface EthersSdk {
  deposits: DepositsResourceType;
  withdrawals: WithdrawalsResourceType;
  tokens: TokensResourceType;
  contracts: ContractsResourceType;
  interop: InteropResourceType;
}

export function createEthersSdk(client: EthersClient): EthersSdk {
  const tokens = createTokensResource(client);
  const contracts = createContractsResource(client);
  const interop = createInteropResource(client);

  return {
    deposits: createDepositsResource(client, tokens, contracts),
    withdrawals: createWithdrawalsResource(client, tokens, contracts),
    tokens,
    contracts,
    interop,
  };
}
