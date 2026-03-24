// src/adapters/ethers/resources/interop/services/fees.ts
//
// Fee helpers for interop routes.
// Handles both fixed ZK-token fee and dynamic protocol-fee (base token) modes.

import { Contract } from 'ethers';
import type { Address } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { ApprovalNeed } from '../../../../../core/types/flows/base';
import type { BuildCtx } from '../context';
import type { InteropFeeInfo } from '../../../../../core/resources/interop/plan';
import { IInteropCenterABI } from '../../../../../core/abi';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../core/types/errors';

const { wrap } = createErrorHandlers('interop');

/**
 * Resolve fee information for a bundle.
 *
 * - useFixed=false (default when fees is unset): reads interopProtocolFee and
 *   returns the total as fee.value so the caller can add it to the sendBundle msg.value.
 * - useFixed=true: reads ZK_INTEROP_FEE and zkToken address, returns an
 *   ApprovalNeed for the ZK token. The route handles the allowance check.
 */
export async function buildFeeInfo(
  params: InteropParams,
  ctx: BuildCtx,
  numStarters: number,
): Promise<InteropFeeInfo> {
  const useFixed = params.fee?.useFixed ?? false;
  const interopCenter = new Contract(ctx.interopCenter, IInteropCenterABI, ctx.client.l2);

  if (useFixed) {
    const zkFeePerCall = await wrap(
      OP_INTEROP.svc.fees.zkInteropFee,
      () => interopCenter.ZK_INTEROP_FEE() as Promise<bigint>,
      { message: 'Failed to fetch ZK interop fee from InteropCenter.' },
    );
    const zkFeeTotal = zkFeePerCall * BigInt(numStarters);

    const zkTokenAddress = await wrap(
      OP_INTEROP.svc.fees.zkToken,
      () => interopCenter.zkToken() as Promise<Address>,
      { message: 'Failed to fetch ZK token address from InteropCenter.' },
    );

    const approval: ApprovalNeed = {
      token: zkTokenAddress,
      spender: ctx.interopCenter,
      amount: zkFeeTotal,
    };

    return {
      approval,
      fee: { token: zkTokenAddress, amount: zkFeeTotal },
    };
  } else {
    const protocolFeePerCall = await wrap(
      OP_INTEROP.svc.fees.protocolFee,
      () => interopCenter.interopProtocolFee() as Promise<bigint>,
      { message: 'Failed to fetch interop protocol fee from InteropCenter.' },
    );
    const totalFee = protocolFeePerCall * BigInt(numStarters);

    return {
      approval: null,
      fee: { token: ctx.baseTokens.src, amount: totalFee },
    };
  }
}
