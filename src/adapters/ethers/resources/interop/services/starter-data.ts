// src/adapters/ethers/resources/interop/services/starter-data.ts
//
// Builds interop starter data for all action types in a bundle.

import type { Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropStarterData } from '../../../../../core/resources/interop/plan';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';
import { assertNever } from '../../../../../core/utils';

/** Build interop starter data for all actions in the bundle. */
export async function getStarterData(
  params: InteropParams,
  ctx: BuildCtx,
  erc20AssetIds: Map<string, Hex>,
): Promise<InteropStarterData[]> {
  const starterData: InteropStarterData[] = [];

  for (const action of params.actions) {
    switch (action.type) {
      case 'sendErc20': {
        const assetId = erc20AssetIds.get(action.token.toLowerCase());
        if (!assetId) {
          throw new Error(`Missing precomputed assetId for token ${action.token}.`);
        }

        const transferData = encodeNativeTokenVaultTransferData(
          action.amount,
          action.to,
          action.token,
        );
        const assetRouterPayload = encodeSecondBridgeDataV1(assetId, transferData) as Hex;
        starterData.push({ assetRouterPayload });
        break;
      }
      case 'sendNative':
        if (!ctx.baseTokens.matches) {
          const assetId = await ctx.tokens.baseTokenAssetId();
          const transferData = encodeNativeTokenVaultTransferData(
            action.amount,
            action.to,
            ctx.baseTokens.src,
          );
          const assetRouterPayload = encodeSecondBridgeDataV1(assetId, transferData) as Hex;
          starterData.push({ assetRouterPayload });
        } else {
          starterData.push({});
        }
        break;
      case 'call':
        starterData.push({});
        break;
      default:
        assertNever(action);
    }
  }

  return starterData;
}
