// src/adapters/ethers/resources/interop/services/erc20.ts
//
// ERC-20 helpers for indirect interop routes.
// Extracted so that route files stay focused on preflight + build flow.

import { Contract, type TransactionRequest } from 'ethers';
import type { Address, Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import { L2NativeTokenVaultABI } from '../../../../../core/abi';

/** Collect unique ERC-20 token addresses referenced by `sendErc20` actions. */
export function getErc20Tokens(params: InteropParams): Address[] {
  const erc20Tokens = new Map<string, Address>();
  for (const action of params.actions) {
    if (action.type !== 'sendErc20') continue;
    erc20Tokens.set(action.token.toLowerCase(), action.token);
  }
  return Array.from(erc20Tokens.values());
}

/** Build NTV `ensureTokenIsRegistered` steps for each ERC-20 token. */
export function buildEnsureTokenSteps(
  erc20Tokens: Address[],
  ctx: BuildCtx,
): Array<{
  key: string;
  kind: string;
  description: string;
  tx: TransactionRequest;
}> {
  if (erc20Tokens.length === 0) return [];

  const ntv = new Contract(ctx.l2NativeTokenVault, L2NativeTokenVaultABI, ctx.client.l2);

  return erc20Tokens.map((token) => ({
    key: `ensure-token:${token.toLowerCase()}`,
    kind: 'interop.ntv.ensure-token',
    description: `Ensure ${token} is registered in the native token vault`,
    tx: {
      to: ctx.l2NativeTokenVault,
      data: ntv.interface.encodeFunctionData('ensureTokenIsRegistered', [token]) as Hex,
      ...ctx.gasOverrides,
    },
  }));
}

/** Resolve asset IDs for each ERC-20 token via a static-call to NTV. */
export async function resolveErc20AssetIds(
  erc20Tokens: Address[],
  ctx: BuildCtx,
): Promise<Map<string, Hex>> {
  const assetIds = new Map<string, Hex>();
  if (erc20Tokens.length === 0) return assetIds;

  const ntv = new Contract(ctx.l2NativeTokenVault, L2NativeTokenVaultABI, ctx.client.getL2Signer());

  for (const token of erc20Tokens) {
    const assetId = (await ntv.getFunction('ensureTokenIsRegistered').staticCall(token)) as Hex;
    assetIds.set(token.toLowerCase(), assetId);
  }

  return assetIds;
}

