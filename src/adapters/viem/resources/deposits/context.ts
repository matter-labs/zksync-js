// src/adapters/viem/resources/deposits/context.ts
import type { ViemClient } from '../../client';
import type { Address } from '../../../../core/types/primitives';
import { getFeeOverrides, type FeeOverrides } from '../utils';
import { pickDepositRoute } from '../../../../core/resources/deposits/route';
import type { DepositParams, DepositRoute } from '../../../../core/types/flows/deposits';
import type { CommonCtx } from '../../../../core/types/flows/base';

// Common context for building deposit (L1→L2) transactions (Viem)
export interface BuildCtx extends CommonCtx {
  client: ViemClient;

  l1AssetRouter: Address;

  fee: FeeOverrides;
  l2GasLimit: bigint;
  gasPerPubdata: bigint;
  operatorTip: bigint;
  refundRecipient: Address;
}

// Prepare a common context for deposit operations
export async function commonCtx(p: DepositParams, client: ViemClient) {
  const { bridgehub, l1AssetRouter } = await client.ensureAddresses();
  const chainId = await client.l2.getChainId();
  const sender = client.account.address;
  const fee = await getFeeOverrides(client, p.l1TxOverrides);

  // TODO: gas default values should be refactored
  const l2GasLimit = p.l2GasLimit ?? 300_000n;
  const gasPerPubdata = p.gasPerPubdata ?? 800n;
  const operatorTip = p.operatorTip ?? 0n;
  const refundRecipient = p.refundRecipient ?? sender;

  const route = await pickDepositRoute(client, BigInt(chainId), p.token);

  return {
    client,
    l1AssetRouter,
    route,
    bridgehub,
    chainIdL2: BigInt(chainId),
    sender,
    fee,
    l2GasLimit,
    gasPerPubdata,
    operatorTip,
    refundRecipient,
  } satisfies BuildCtx & { route: DepositRoute };
}
