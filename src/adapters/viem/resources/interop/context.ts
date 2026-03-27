// src/adapters/viem/resources/interop/context.ts
import type { PublicClient } from 'viem';
import type { ViemClient } from '../../client';
import type { Address } from '../../../../core/types/primitives';
import type { CommonCtx } from '../../../../core/types/flows/base';
import type { InteropParams } from '../../../../core/types/flows/interop';
import { type TxGasOverrides, toGasOverrides } from '../../../../core/types/fees';
import type { TokensResource } from '../../../../core/types/flows/token';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import type { ContractsResource } from '../contracts';
import { assertProtocolVersion } from '../../../../core/resources/interop/protocol';

async function assertInteropProtocolVersion(
  client: ViemClient,
  srcChainId: bigint,
  dstChainId: bigint,
): Promise<void> {
  const [srcProtocolVersion, dstProtocolVersion] = await Promise.all([
    client.getProtocolVersion(srcChainId),
    client.getProtocolVersion(dstChainId),
  ]);

  assertProtocolVersion(srcChainId, srcProtocolVersion);
  assertProtocolVersion(dstChainId, dstProtocolVersion);
}

// Common context for building interop (L2 -> L2) transactions
export interface BuildCtx extends CommonCtx {
  client: ViemClient;
  tokens: TokensResource;
  contracts: ContractsResource;

  bridgehub: Address;
  dstChainId: bigint;
  dstPublicClient: PublicClient;
  chainId: bigint;
  interopCenter: Address;
  interopHandler: Address;
  l2MessageVerification: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;

  baseTokens: { src: Address; dst: Address; matches: boolean };
  attributes: AttributesResource;
  gasOverrides?: TxGasOverrides;
}

export async function commonCtx(
  dstPublicClient: PublicClient,
  params: InteropParams,
  client: ViemClient,
  tokens: TokensResource,
  contracts: ContractsResource,
  attributes: AttributesResource,
): Promise<BuildCtx> {
  const sender = client.account.address;
  const chainId = BigInt(await client.l2.getChainId());
  const dstChainId = BigInt(await dstPublicClient.getChainId());

  const {
    bridgehub,
    l2AssetRouter,
    l2NativeTokenVault,
    interopCenter,
    interopHandler,
    l2MessageVerification,
  } = await contracts.addresses();

  await assertInteropProtocolVersion(client, chainId, dstChainId);

  const [srcBaseToken, dstBaseToken] = await Promise.all([
    client.baseToken(chainId),
    client.baseToken(dstChainId),
  ]);

  const baseMatches = srcBaseToken.toLowerCase() === dstBaseToken.toLowerCase();

  return {
    client,
    tokens,
    contracts,
    sender,
    chainIdL2: chainId,
    chainId,
    bridgehub,
    dstChainId,
    dstPublicClient,
    interopCenter,
    interopHandler,
    l2MessageVerification,
    l2AssetRouter,
    l2NativeTokenVault,
    baseTokens: { src: srcBaseToken, dst: dstBaseToken, matches: baseMatches },
    attributes,
    gasOverrides: params.txOverrides ? toGasOverrides(params.txOverrides) : undefined,
  } satisfies BuildCtx;
}
