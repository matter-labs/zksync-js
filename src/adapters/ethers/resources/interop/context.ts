// src/adapters/ethers/resources/interop/context.ts
import { Interface } from 'ethers';
import type { EthersClient } from '../../client';
import type { Address, Hex } from '../../../../core/types/primitives';
import type { CommonCtx } from '../../../../core/types/flows/base';
import type { InteropParams } from '../../../../core/types/flows/interop';
import type { TxOverrides } from '../../../../core/types/fees';
import type { TokensResource } from '../../../../core/types/flows/token';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import type { InteropTopics } from '../../../../core/resources/interop/events';
import type { ContractsResource } from '../contracts';
import { IInteropHandlerABI, InteropCenterABI } from '../../../../core/abi';

// Common context for building interop (L2 -> L2) transactions
export interface BuildCtx extends CommonCtx {
  client: EthersClient;
  tokens: TokensResource;
  contracts: ContractsResource;

  bridgehub: Address;
  dstChainId: bigint;
  chainId: bigint;
  interopCenter: Address;
  interopHandler: Address;
  l2MessageVerification: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;

  baseTokens: { src: Address; dst: Address };
  ifaces: { interopCenter: Interface; interopHandler: Interface };
  topics: InteropTopics;
  attributes: AttributesResource;
  gasOverrides?: TxOverrides;
}

export async function commonCtx(
  params: InteropParams,
  client: EthersClient,
  tokens: TokensResource,
  contracts: ContractsResource,
  attributes: AttributesResource,
): Promise<BuildCtx> {
  const sender = (params.sender ?? (await client.signer.getAddress())) as Address;
  const chainId = BigInt((await client.l2.getNetwork()).chainId);
  const { dstChainId } = params;

  // Ensure the source chain provider is present in chainMap for create/status flows.
  if (!client.getProvider(chainId)) {
    client.registerChain(chainId, client.l2);
  }

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

  const interopCenterIface = new Interface(InteropCenterABI);
  const interopHandlerIface = new Interface(IInteropHandlerABI);

  const topics: InteropTopics = {
    interopBundleSent: interopCenterIface.getEvent('InteropBundleSent')!.topicHash as Hex,
    bundleVerified: interopHandlerIface.getEvent('BundleVerified')!.topicHash as Hex,
    bundleExecuted: interopHandlerIface.getEvent('BundleExecuted')!.topicHash as Hex,
    bundleUnbundled: interopHandlerIface.getEvent('BundleUnbundled')!.topicHash as Hex,
  };

  return {
    client,
    tokens,
    contracts,
    sender,
    chainIdL2: chainId,
    chainId,
    bridgehub,
    dstChainId,
    interopCenter,
    interopHandler,
    l2MessageVerification,
    l2AssetRouter,
    l2NativeTokenVault,
    baseTokens: { src: srcBaseToken, dst: dstBaseToken },
    ifaces: { interopCenter: interopCenterIface, interopHandler: interopHandlerIface },
    topics,
    attributes,
    gasOverrides: params.txOverrides,
  } satisfies BuildCtx;
}
