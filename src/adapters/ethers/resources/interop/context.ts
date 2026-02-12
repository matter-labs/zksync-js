// src/adapters/ethers/resources/interop/context.ts
import type { AbstractProvider } from 'ethers';
import { Interface } from 'ethers';
import type { EthersClient } from '../../client';
import type { Address } from '../../../../core/types/primitives';
import type { CommonCtx } from '../../../../core/types/flows/base';
import type { InteropParams } from '../../../../core/types/flows/interop';
import type { TxOverrides } from '../../../../core/types/fees';
import type { TokensResource } from '../../../../core/types/flows/token';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import type { ContractsResource } from '../contracts';
import { IInteropHandlerABI, InteropCenterABI } from '../../../../core/abi';

// Common context for building interop (L2 -> L2) transactions
export interface BuildCtx extends CommonCtx {
  client: EthersClient;
  tokens: TokensResource;
  contracts: ContractsResource;

  bridgehub: Address;
  dstChainId: bigint;
  dstProvider: AbstractProvider;
  chainId: bigint;
  interopCenter: Address;
  interopHandler: Address;
  l2MessageVerification: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;

  baseTokens: { src: Address; dst: Address; matches: boolean };
  ifaces: { interopCenter: Interface; interopHandler: Interface };
  attributes: AttributesResource;
  gasOverrides?: TxOverrides;
}

export async function commonCtx(
  dstProvider: AbstractProvider,
  params: InteropParams,
  client: EthersClient,
  tokens: TokensResource,
  contracts: ContractsResource,
  attributes: AttributesResource,
): Promise<BuildCtx> {
  const sender = (await client.signer.getAddress()) as Address;
  const chainId = (await client.l2.getNetwork()).chainId;
  const dstChainId = (await dstProvider.getNetwork()).chainId;

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
    dstProvider,
    interopCenter,
    interopHandler,
    l2MessageVerification,
    l2AssetRouter,
    l2NativeTokenVault,
    baseTokens: { src: srcBaseToken, dst: dstBaseToken, matches: baseMatches },
    ifaces: { interopCenter: interopCenterIface, interopHandler: interopHandlerIface },
    attributes,
    gasOverrides: params.txOverrides,
  } satisfies BuildCtx;
}
