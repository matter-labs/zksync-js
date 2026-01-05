// src/adapters/ethers/resources/deposits/context.ts

import type { EthersClient } from '../../client';
import type { Address, Hex } from '../../../../core/types/primitives';
import type { DepositParams, DepositRoute } from '../../../../core/types/flows/deposits';
import type { CommonCtx } from '../../../../core/types/flows/base';
import type { TxOverrides } from '../../../../core/types/fees';
import type { ResolvedToken, TokensResource } from '../tokens/types';

// Common context for building deposit (L1-L2) transactions
export interface BuildCtx extends CommonCtx {
  client: EthersClient;
  tokens: TokensResource;

  // Token facts
  resolvedToken: ResolvedToken;
  baseTokenAssetId: Hex;
  baseTokenL1: Address;
  baseIsEth: boolean;

  l1AssetRouter: Address;

  gasOverrides?: TxOverrides;
  l2GasLimit?: bigint;
  gasPerPubdata: bigint;
  operatorTip: bigint;
  refundRecipient: Address;
}

// Prepare a common context for deposit operations
export async function commonCtx(p: DepositParams, client: EthersClient, tokens: TokensResource) {
  const { bridgehub, l1AssetRouter } = await client.ensureAddresses();
  const { chainId } = await client.l2.getNetwork();
  const sender = (await client.signer.getAddress()) as Address;

  const gasPerPubdata = p.gasPerPubdata ?? 800n;
  const operatorTip = p.operatorTip ?? 0n;
  const refundRecipient = p.refundRecipient ?? sender;

  const resolvedToken = await tokens.resolve(p.token, { chain: 'l1' });
  const baseTokenAssetId = resolvedToken.baseTokenAssetId;
  const baseTokenL1 = await tokens.l1TokenFromAssetId(baseTokenAssetId);
  const baseIsEth = resolvedToken.isChainEthBased;

  const route: DepositRoute = (() => {
    if (resolvedToken.kind === 'eth') {
      return baseIsEth ? 'eth-base' : 'eth-nonbase';
    }
    if (resolvedToken.kind === 'base') {
      return baseIsEth ? 'eth-base' : 'erc20-base';
    }
    return 'erc20-nonbase';
  })();

  return {
    client,
    tokens,
    resolvedToken,
    baseTokenAssetId,
    baseTokenL1,
    baseIsEth,
    l1AssetRouter,
    route,
    bridgehub,
    chainIdL2: BigInt(chainId),
    sender,
    gasOverrides: p.l1TxOverrides,
    l2GasLimit: p.l2GasLimit,
    gasPerPubdata,
    operatorTip,
    refundRecipient,
  } satisfies BuildCtx & { route: DepositRoute };
}
