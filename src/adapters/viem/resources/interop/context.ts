// src/adapters/viem/resources/interop/context.ts
import type { PublicClient, Abi } from 'viem';
import type { ViemClient, ProtocolVersion } from '../../client';
import type { Address } from '../../../../core/types/primitives';
import type { CommonCtx } from '../../../../core/types/flows/base';
import type { InteropParams } from '../../../../core/types/flows/interop';
import { type TxGasOverrides, toGasOverrides } from '../../../../core/types/fees';
import type { TokensResource } from '../../../../core/types/flows/token';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import type { ContractsResource } from '../contracts';
import { IBridgehubABI } from '../../../../core/abi';
import {
  L2_INTEROP_CENTER_ADDRESS,
  L2_INTEROP_HANDLER_ADDRESS,
  L2_MESSAGE_VERIFICATION_ADDRESS,
} from '../../../../core/constants';
import { createError } from '../../../../core/errors/factory';
import { OP_INTEROP } from '../../../../core/types/errors';

const MIN_INTEROP_PROTOCOL = 31;

async function assertInteropProtocolVersion(
  client: ViemClient,
  srcChainId: bigint,
  dstChainId: bigint,
): Promise<void> {
  const [srcProtocolVersion, dstProtocolVersion] = await Promise.all([
    client.getProtocolVersion(srcChainId),
    client.getProtocolVersion(dstChainId),
  ]);

  const assertProtocolVersion = (chainId: bigint, protocolVersion: ProtocolVersion): void => {
    if (protocolVersion[1] < MIN_INTEROP_PROTOCOL) {
      throw createError('VALIDATION', {
        resource: 'interop',
        operation: OP_INTEROP.context.protocolVersion,
        message: `Interop requires protocol version 31.0+. Found: ${protocolVersion[1]}.${protocolVersion[2]} for chain: ${chainId}.`,
        context: {
          chainId,
          requiredMinor: MIN_INTEROP_PROTOCOL,
          semver: protocolVersion,
        },
      });
    }
  };

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

  const { bridgehub, l2AssetRouter, l2NativeTokenVault } = await contracts.addresses();

  const interopCenter = L2_INTEROP_CENTER_ADDRESS;
  const interopHandler = L2_INTEROP_HANDLER_ADDRESS;
  const l2MessageVerification = L2_MESSAGE_VERIFICATION_ADDRESS;

  await assertInteropProtocolVersion(client, chainId, dstChainId);

  const [srcBaseToken, dstBaseToken] = await Promise.all([
    client.baseToken(chainId),
    (async () => {
      const bh = (await contracts.addresses()).bridgehub;
      return (await client.l1.readContract({
        address: bh,
        abi: IBridgehubABI as Abi,
        functionName: 'baseToken',
        args: [dstChainId],
      })) as Address;
    })(),
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
