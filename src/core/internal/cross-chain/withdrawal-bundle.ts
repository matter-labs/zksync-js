import type { InteropAddressCodec, InteropStarter } from '../../resources/interop/plan';
import type { AttributesResource } from '../../resources/interop/attributes/resource';
import type { Address, Hex } from '../../types/primitives';

export interface BuildWithdrawalBundleInput {
  kind: 'base' | 'erc20';
  amount: bigint;
  l1ChainId: bigint;
  l2AssetRouter: Address;
  assetRouterPayload: Hex;
  salt: Hex;
  codec: InteropAddressCodec;
  attributes: AttributesResource;
}

export interface WithdrawalBundlePlan {
  dstChain: Hex;
  starters: [InteropStarter];
  bundleAttributes: [Hex];
  transactionValue: bigint;
  protocolFee: 0n;
}

export function buildWithdrawalBundle(input: BuildWithdrawalBundleInput): WithdrawalBundlePlan {
  const indirectCallValue = input.kind === 'base' ? input.amount : 0n;
  const callAttributes: Hex[] = [
    input.attributes.call.indirectCall(indirectCallValue),
    input.attributes.call.interopCallValue(0n),
  ];

  return {
    dstChain: input.codec.formatChain(input.l1ChainId),
    starters: [
      [input.codec.formatAddress(input.l2AssetRouter), input.assetRouterPayload, callAttributes],
    ],
    bundleAttributes: [input.attributes.bundle.interopBundleSalt(input.salt)],
    transactionValue: indirectCallValue,
    protocolFee: 0n,
  };
}
