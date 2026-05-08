import type { Abi } from 'viem';

import { IERC20ABI } from '../../../../../core/abi.ts';
import type { Address } from '../../../../../core/types/primitives';
import type { BuildCtx } from '../context';
import type { ViemPlanWriteRequest } from './types';

type BuildApprovalRequestInput = {
  ctx: BuildCtx;
  token: Address;
  spender: Address;
  amount: bigint;
};

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current = error as { cause?: unknown } | undefined;

  for (let depth = 0; current && depth < 8; depth++) {
    const record = current as Record<string, unknown>;
    for (const key of ['name', 'shortMessage', 'message', 'details']) {
      const value = record[key];
      if (typeof value === 'string') parts.push(value);
    }
    current = record.cause as { cause?: unknown } | undefined;
  }

  return parts.join('\n');
}

function isNoReturnApproveSimulationError(error: unknown): boolean {
  const text = errorText(error);

  return (
    /approve/i.test(text) &&
    (/returned no data/i.test(text) ||
      /return(?:ed)? data[^\n]*0x/i.test(text) ||
      /0x[^\n]*no data/i.test(text))
  );
}

export async function buildApprovalRequest({
  ctx,
  token,
  spender,
  amount,
}: BuildApprovalRequestInput): Promise<ViemPlanWriteRequest> {
  try {
    const sim = await ctx.client.l1.simulateContract({
      address: token,
      abi: IERC20ABI as Abi,
      functionName: 'approve',
      args: [spender, amount] as const,
      account: ctx.client.account,
    });

    return { ...sim.request } as ViemPlanWriteRequest;
  } catch (error) {
    if (!isNoReturnApproveSimulationError(error)) {
      throw error;
    }

    return {
      address: token,
      abi: IERC20ABI as Abi,
      functionName: 'approve',
      args: [spender, amount] as const,
      account: ctx.client.account,
    } as ViemPlanWriteRequest;
  }
}
