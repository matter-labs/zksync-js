// src/adapters/viem/resources/withdrawals/context.ts

import type { ViemClient } from '../../client';
import type { Address } from '../../../../core/types/primitives';
import { pickWithdrawRoute } from '../../../../core/resources/withdrawals/route';
import { type WithdrawParams, type WithdrawRoute } from '../../../../core/types/flows/withdrawals';
import type { CommonCtx } from '../../../../core/types/flows/base';
import { type TxGasOverrides, toGasOverrides } from '../../../../core/types/fees';
import type { Hex } from '../../../../core/types/primitives';
import type { ResolvedToken, TokensResource } from '../../../../core/types/flows/token';
import type { ContractsResource } from '../contracts';
import type { WithdrawalProtocol } from '../../../../core/resources/withdrawals/protocol';

// Common context for building withdrawal (L2 -> L1) transactions
export interface BuildCtx extends CommonCtx {
  client: ViemClient;
  tokens: TokensResource;
  contracts: ContractsResource;

  // Token facts
  resolvedToken: ResolvedToken;
  baseTokenAssetId: Hex;
  baseTokenL1: Address;
  baseIsEth: boolean;

  /** Which token kind is being withdrawn: the chain's base token, or a non-base ERC-20. */
  route: WithdrawRoute;

  /**
   * Which withdrawal protocol the chain speaks. Selects the route builder and the finalization
   * entry point; see `core/resources/withdrawals/protocol.ts`.
   */
  protocol: WithdrawalProtocol;

  /** Chain id of L1 — the destination of a v32 withdrawal bundle. */
  l1ChainId: bigint;

  // L1 + L2 well-knowns
  bridgehub: Address;
  l1AssetRouter: Address;
  l1Nullifier: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  l2BaseTokenSystem: Address;
  interopCenter: Address;

  // L2 gas
  gasOverrides?: TxGasOverrides;
}

export async function commonCtx(
  p: WithdrawParams,
  client: ViemClient,
  tokens: TokensResource,
  contracts: ContractsResource,
  protocol: WithdrawalProtocol,
): Promise<BuildCtx & { route: WithdrawRoute }> {
  const sender = client.account.address;

  const {
    bridgehub,
    l1AssetRouter,
    l1Nullifier,
    l2AssetRouter,
    l2NativeTokenVault,
    l2BaseTokenSystem,
    interopCenter,
  } = await contracts.addresses();

  const chainIdL2 = BigInt(await client.l2.getChainId());
  // Destination of a v32 withdrawal bundle. Read from the L1 provider rather than assumed, so the
  // same code path works on local/forked ecosystems.
  const l1ChainId = BigInt(await client.l1.getChainId());

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
    interopCenter,
    protocol,
    l1ChainId,
    baseIsEth,
    gasOverrides: p.l2TxOverrides ? toGasOverrides(p.l2TxOverrides) : undefined,
  } satisfies BuildCtx & { route: WithdrawRoute };
}
