// src/adapters/ethers/resources/withdrawals/context.ts

import type { EthersClient } from '../../client';
import type { Address } from '../../../../core/types/primitives';
import { pickWithdrawRoute } from '../../../../core/resources/withdrawals/route';
import { type WithdrawParams, type WithdrawRoute } from '../../../../core/types/flows/withdrawals';
import type { CommonCtx } from '../../../../core/types/flows/base';
import { type TxGasOverrides, toGasOverrides } from '../../../../core/types/fees';
import type { Hex } from '../../../../core/types/primitives';
import type { ResolvedToken, TokensResource } from '../../../../core/types/flows/token';
import type { ContractsResource } from '../contracts';

// Common context for building withdrawal (L2 -> L1) transactions
export interface BuildCtx extends CommonCtx {
  client: EthersClient;
  tokens: TokensResource;
  contracts: ContractsResource;

  // Token facts
  resolvedToken: ResolvedToken;
  baseTokenAssetId: Hex;
  baseTokenL1: Address;
  baseIsEth: boolean;

  // L1 + L2 well-knowns
  bridgehub: Address;
  l1AssetRouter: Address;
  l1Nullifier: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  l2BaseTokenSystem: Address;

  // L2 gas
  gasOverrides?: TxGasOverrides;
}

export async function commonCtx(
  p: WithdrawParams,
  client: EthersClient,
  tokens: TokensResource,
  contracts: ContractsResource,
): Promise<BuildCtx & { route: WithdrawRoute }> {
  const sender = (await client.signer.getAddress()) as Address;

  const {
    bridgehub,
    l1AssetRouter,
    l1Nullifier,
    l2AssetRouter,
    l2NativeTokenVault,
    l2BaseTokenSystem,
  } = await contracts.addresses();

  const { chainId } = await client.l2.getNetwork();
  const chainIdL2 = BigInt(chainId);

  const resolvedToken = await tokens.resolve(p.token, { chain: 'l2' });
  const baseTokenAssetId = resolvedToken.baseTokenAssetId;
  const baseTokenL1 = await tokens.l1TokenFromAssetId(baseTokenAssetId);
  const baseIsEth = resolvedToken.isChainEthBased;

  // route selection
  const route = pickWithdrawRoute({ token: p.token, baseIsEth });

  return {
    client,
    tokens,
    contracts,
    resolvedToken,
    baseTokenAssetId,
    baseTokenL1,
    bridgehub,
    chainIdL2,
    sender,
    route,
    l1AssetRouter,
    l1Nullifier,
    l2AssetRouter,
    l2NativeTokenVault,
    l2BaseTokenSystem,
    baseIsEth,
    gasOverrides: p.l2TxOverrides ? toGasOverrides(p.l2TxOverrides) : undefined,
  } satisfies BuildCtx & { route: WithdrawRoute };
}
