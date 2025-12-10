// src/adapters/ethers/resources/withdrawals/context.ts

import type { EthersClient } from '../../client';
import type { Address } from '../../../../core/types/primitives';
import { pickWithdrawRoute } from '../../../../core/resources/withdrawals/route';
import type { WithdrawParams, WithdrawRoute } from '../../../../core/types/flows/withdrawals';
import type { CommonCtx, ResolvedEip1559Fees } from '../../../../core/types/flows/base';
import { isEthBasedChain } from '../token-info';
import { getL2FeeOverrides } from '../utils';

// TODO: consider if we need this / improve
const GAS_BUFFER_PCT_DEFAULT = 15;

// Common context for building withdrawal (L2 -> L1) transactions
export interface BuildCtx extends CommonCtx {
  client: EthersClient;

  // L1 + L2 well-knowns
  l1AssetRouter: Address;
  l1Nullifier: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  l2BaseTokenSystem: Address;

  // Base token info
  baseIsEth: boolean;

  // L2 gas
  l2GasLimit: bigint;
  gasBufferPct: number;

  // Optional fee overrides for L2 send
  fee: ResolvedEip1559Fees;
}

export async function commonCtx(
  p: WithdrawParams,
  client: EthersClient,
): Promise<BuildCtx & { route: WithdrawRoute }> {
  const sender = (await client.signer.getAddress()) as Address;

  const {
    bridgehub,
    l1AssetRouter,
    l1Nullifier,
    l2AssetRouter,
    l2NativeTokenVault,
    l2BaseTokenSystem,
  } = await client.ensureAddresses();

  const { chainId } = await client.l2.getNetwork();
  const chainIdL2 = BigInt(chainId);
  const baseIsEth = await isEthBasedChain(client.l2, l2NativeTokenVault);
  const fee = await getL2FeeOverrides(client, p.l2TxOverrides);

  // route selection
  const route = pickWithdrawRoute({ token: p.token, baseIsEth });

  // TODO: improve gas estimations
  const l2GasLimit = p.l2GasLimit ?? 300_000n;

  return {
    client,
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
    l2GasLimit,
    gasBufferPct: GAS_BUFFER_PCT_DEFAULT,
    fee,
  } satisfies BuildCtx & { route: WithdrawRoute };
}
