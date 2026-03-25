// src/adapters/viem/resources/interop/services/erc20.ts
//
// ERC-20 helpers for indirect interop routes.

import { encodeFunctionData, type Abi } from 'viem';
import type { Address, Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { ApprovalNeed } from '../../../../../core/types/flows/base';
import type { BuildCtx } from '../context';
import type { ViemTransactionRequest } from '../routes/types';
import { IERC20ABI, L2NativeTokenVaultABI } from '../../../../../core/abi';

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
  tx: ViemTransactionRequest;
}> {
  if (erc20Tokens.length === 0) return [];

  return erc20Tokens.map((token) => ({
    key: `ensure-token:${token.toLowerCase()}`,
    kind: 'interop.ntv.ensure-token',
    description: `Ensure ${token} is registered in the native token vault`,
    tx: {
      to: ctx.l2NativeTokenVault,
      data: encodeFunctionData({
        abi: L2NativeTokenVaultABI as Abi,
        functionName: 'ensureTokenIsRegistered',
        args: [token],
      }),
      ...ctx.gasOverrides,
    },
  }));
}

/**
 * Check allowance for each approval and return approve steps only where needed.
 */
export async function buildApproveSteps(
  approvals: ApprovalNeed[],
  ctx: BuildCtx,
): Promise<Array<{ key: string; kind: string; description: string; tx: ViemTransactionRequest }>> {
  const steps: Array<{
    key: string;
    kind: string;
    description: string;
    tx: ViemTransactionRequest;
  }> = [];

  for (const approval of approvals) {
    const currentAllowance = (await ctx.client.l2.readContract({
      address: approval.token,
      abi: IERC20ABI as Abi,
      functionName: 'allowance',
      args: [ctx.sender, approval.spender],
    })) as bigint;

    if (currentAllowance < approval.amount) {
      steps.push({
        key: `approve:${approval.token}:${approval.spender}`,
        kind: 'approve',
        description: `Approve ${approval.spender} to spend ${approval.amount} of ${approval.token}`,
        tx: {
          to: approval.token,
          data: encodeFunctionData({
            abi: IERC20ABI as Abi,
            functionName: 'approve',
            args: [approval.spender, approval.amount],
          }),
          ...ctx.gasOverrides,
        },
      });
    }
  }

  return steps;
}

/** Resolve asset IDs for each ERC-20 token via a static-call to NTV. */
export async function resolveErc20AssetIds(
  erc20Tokens: Address[],
  ctx: BuildCtx,
): Promise<Map<string, Hex>> {
  const assetIds = new Map<string, Hex>();
  if (erc20Tokens.length === 0) return assetIds;

  for (const token of erc20Tokens) {
    const { result: assetId } = await ctx.client.l2.simulateContract({
      address: ctx.l2NativeTokenVault,
      abi: L2NativeTokenVaultABI as Abi,
      functionName: 'ensureTokenIsRegistered',
      args: [token],
      account: ctx.sender,
    });
    assetIds.set(token.toLowerCase(), assetId as Hex);
  }

  return assetIds;
}
