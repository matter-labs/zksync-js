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
import { createTokensResource } from './resources/tokens/index';
import type { TokensResource as TokensResourceType } from '../../core/types/flows/token';
import type { ContractsResource as ContractsResourceType } from './resources/contracts/index';
import { createContractsResource } from './resources/contracts/index';

// SDK interface, combining deposits, withdrawals, tokens, and contracts
export interface EthersSdk {
  deposits: DepositsResourceType;
  withdrawals: WithdrawalsResourceType;
  tokens: TokensResourceType;
  contracts: ContractsResourceType;
}

export function createEthersSdk(client: EthersClient): EthersSdk {
  return {
    deposits: createDepositsResource(client),
    withdrawals: createWithdrawalsResource(client),
    tokens: createTokensResource(client),
    contracts: createContractsResource(client),
  };
}
