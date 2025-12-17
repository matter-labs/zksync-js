// src/adapters/ethers/resources/deposits/context.ts

import type { EthersClient } from '../../client';
import type { Address } from '../../../../core/types/primitives';
import { pickDepositRoute } from '../../../../core/resources/deposits/route';
import type { DepositParams, DepositRoute } from '../../../../core/types/flows/deposits';
import type { CommonCtx } from '../../../../core/types/flows/base';
import type { TxOverrides } from '../../../../core/types/fees';

// Common context for building deposit (L1-L2) transactions
export interface BuildCtx extends CommonCtx {
  client: EthersClient;

  l1AssetRouter: Address;

  gasOverrides?: TxOverrides;
  l2GasLimit?: bigint;
  gasPerPubdata: bigint;
  operatorTip: bigint;
  refundRecipient: Address;
}

// Prepare a common context for deposit operations
export async function commonCtx(p: DepositParams, client: EthersClient) {
  const { bridgehub, l1AssetRouter } = await client.ensureAddresses();
  const { chainId } = await client.l2.getNetwork();
  const sender = (await client.signer.getAddress()) as Address;

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
    gasOverrides: p.l1TxOverrides,
    l2GasLimit: p.l2GasLimit,
    gasPerPubdata,
    operatorTip,
    refundRecipient,
  } satisfies BuildCtx & { route: DepositRoute };
}
