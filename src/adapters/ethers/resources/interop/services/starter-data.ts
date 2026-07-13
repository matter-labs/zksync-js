// src/adapters/ethers/resources/interop/services/starter-data.ts
//
// Builds interop starter data for all action types in a bundle.

import type { Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { InteropStarterData } from '../../../../../core/resources/interop/plan';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';
import { assertNever } from '../../../../../core/utils';

/** Build interop starter data for all actions in the bundle. */
export function getStarterData(
  params: InteropParams,
  erc20AssetIds: Map<string, Hex>,
): InteropStarterData[] {
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
      case 'call':
        starterData.push({});
        break;
      default:
        assertNever(action);
    }
  }

  return starterData;
}
