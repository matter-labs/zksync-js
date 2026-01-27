// src/adapters/viem/sdk.ts
import type { ViemClient } from './client';

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
import { createContractsResource } from './resources/contracts';
import type { ContractsResource as ContractsResourceType } from './resources/contracts';

// Main SDK interface (Viem)
export interface ViemSdk {
  deposits: DepositsResourceType;
  withdrawals: WithdrawalsResourceType;
  tokens: TokensResourceType;
  contracts: ContractsResourceType;
  interop: InteropResourceType;
}

export function createViemSdk(client: ViemClient): ViemSdk {
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
