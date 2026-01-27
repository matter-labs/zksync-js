import { getAbiItem, getEventSelector } from 'viem';
import type { ViemClient } from '../../client';
import type { Address, Hex } from '../../../../core/types/primitives';
import type { CommonCtx } from '../../../../core/types/flows/base';
import type { InteropParams, InteropRoute } from '../../../../core/types/flows/interop';
import type { TokensResource } from '../../../../core/types/flows/token';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import type { InteropTopics } from '../../../../core/resources/interop/events';
import type { ContractsResource } from '../contracts';
import { IInteropHandlerABI, InteropCenterABI } from '../../../../core/abi';
import { createViemAttributesResource } from './attributes';
import { pickInteropRoute } from '../../../../core/resources/interop/route';

export interface BuildCtx extends CommonCtx {
  client: ViemClient;
  tokens: TokensResource;
  contracts: ContractsResource;

  bridgehub: Address;
  dstChainId: bigint;
  interopCenter: Address;
  interopHandler: Address;
  l2MessageVerification: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;

  baseTokens: { src: Address; dst: Address };
  topics: InteropTopics;
  attributes: AttributesResource;
}

function eventTopic(abi: unknown, name: string): Hex {
  const item = getAbiItem({ abi: abi as any, name });
  return getEventSelector(item as any) as Hex;
}

export async function commonCtx(
  p: InteropParams,
  client: ViemClient,
  tokens: TokensResource,
  contracts: ContractsResource,
  attributes: AttributesResource = createViemAttributesResource(),
): Promise<BuildCtx & { route: InteropRoute }> {
  const sender = client.account.address as Address;
  const chainId = BigInt(await client.l2.getChainId());
  const dstChainId = p.dst;

  const {
    bridgehub,
    l2AssetRouter,
    l2NativeTokenVault,
    interopCenter,
    interopHandler,
    l2MessageVerification,
  } = await contracts.addresses();

  const [srcBaseToken, dstBaseToken] = await Promise.all([
    client.baseToken(chainId),
    client.baseToken(dstChainId),
  ]);

  const topics: InteropTopics = {
    interopBundleSent: eventTopic(InteropCenterABI, 'InteropBundleSent'),
    bundleVerified: eventTopic(IInteropHandlerABI, 'BundleVerified'),
    bundleExecuted: eventTopic(IInteropHandlerABI, 'BundleExecuted'),
    bundleUnbundled: eventTopic(IInteropHandlerABI, 'BundleUnbundled'),
  };

  const route = pickInteropRoute({
    actions: p.actions,
    ctx: {
      sender,
      srcChainId: chainId,
      dstChainId,
      baseTokenSrc: srcBaseToken,
      baseTokenDst: dstBaseToken,
    },
  });

  return {
    client,
    tokens,
    contracts,
    sender,
    chainId,
    bridgehub,
    dstChainId,
    interopCenter,
    interopHandler,
    l2MessageVerification,
    l2AssetRouter,
    l2NativeTokenVault,
    baseTokens: { src: srcBaseToken, dst: dstBaseToken },
    topics,
    attributes,
    route,
  } satisfies BuildCtx & { route: InteropRoute };
}
