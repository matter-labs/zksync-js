// src/adapters/viem/resources/withdrawals/context.ts

import type { ViemClient } from '../../client';
import type { Address } from '../../../../core/types/primitives';
import { pickWithdrawRoute } from '../../../../core/resources/withdrawals/route';
import { type WithdrawParams, type WithdrawRoute } from '../../../../core/types/flows/withdrawals';
import type { CommonCtx } from '../../../../core/types/flows/base';
import type { TxOverrides } from '../../../../core/types/fees';
import { createNTVCodec } from '../../../../core/codec/ntv';
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { ETH_ADDRESS, L2_NATIVE_TOKEN_VAULT_ADDRESS } from '../../../../core/constants';

// Create NTV codec for assetId calculations
const ntvCodec = createNTVCodec({
  encode: (types, values) =>
    encodeAbiParameters(
      types.map((t, i) => ({ type: t, name: `arg${i}` })),
      values,
    ),
  keccak256: (data: Hex) => keccak256(data),
});

// Common context for building withdrawal (L2 -> L1) transactions
export interface BuildCtx extends CommonCtx {
  client: ViemClient;

  // L1 + L2 well-knowns
  bridgehub: Address;
  l1AssetRouter: Address;
  l1Nullifier: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  l2BaseTokenSystem: Address;

  // Base token info
  baseIsEth: boolean;

  // L2 gas
  gasOverrides?: TxOverrides;
}

export async function commonCtx(
  p: WithdrawParams,
  client: ViemClient,
): Promise<BuildCtx & { route: WithdrawRoute }> {
  const sender = client.account.address;

  const {
    bridgehub,
    l1AssetRouter,
    l1Nullifier,
    l2AssetRouter,
    l2NativeTokenVault,
    l2BaseTokenSystem,
  } = await client.ensureAddresses();

  const chainIdL2 = BigInt(await client.l2.getChainId());

  // Check if chain is ETH-based by comparing base token assetId with ETH assetId
  const { l2NativeTokenVault: l2NtvContract } = await client.contracts();
  const [baseTokenAssetId, l1ChainId] = await Promise.all([
    l2NtvContract.read.BASE_TOKEN_ASSET_ID(),
    l2NtvContract.read.L1_CHAIN_ID(),
  ]);
  const ethAssetId = ntvCodec.encodeAssetId(l1ChainId, L2_NATIVE_TOKEN_VAULT_ADDRESS, ETH_ADDRESS);
  const baseIsEth = baseTokenAssetId.toLowerCase() === ethAssetId.toLowerCase();

  // route selection
  const route = pickWithdrawRoute({ token: p.token, baseIsEth });

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
    gasOverrides: p.l2TxOverrides,
  } satisfies BuildCtx & { route: WithdrawRoute };
}
