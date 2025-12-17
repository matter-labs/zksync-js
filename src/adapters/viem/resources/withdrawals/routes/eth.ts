// src/adapters/viem/resources/withdrawals/routes/eth.ts

import type { Abi, TransactionRequest } from 'viem';
import { encodeFunctionData } from 'viem';

import type { WithdrawRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep } from '../../../../../core/types/flows/base';

import { L2_BASE_TOKEN_ADDRESS } from '../../../../../core/constants';
import { IBaseTokenABI } from '../../../../../core/abi.ts';

import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_WITHDRAWALS } from '../../../../../core/types';

import { quoteL2Gas } from '../services/gas.ts';
import { buildFeeBreakdown } from '../services/fee.ts';

const { wrapAs } = createErrorHandlers('withdrawals');

// Route for withdrawing ETH via L2 Base Token System
export function routeEthBase(): WithdrawRouteStrategy {
  return {
    async build(p, ctx) {
      const steps: Array<PlanStep<ViemPlanWriteRequest>> = [];

      const data = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.eth.encodeWithdraw,
        () =>
          Promise.resolve(
            encodeFunctionData({
              abi: IBaseTokenABI as Abi,
              functionName: 'withdraw',
              args: [p.to ?? ctx.sender] as const,
            }),
          ),
        {
          ctx: { where: 'L2BaseToken.withdraw', to: p.to ?? ctx.sender },
          message: 'Failed to encode ETH withdraw calldata.',
        },
      );

      // L2 transaction for gas estimation
      const L2tx: TransactionRequest = {
        to: L2_BASE_TOKEN_ADDRESS,
        data,
        value: p.amount,
        from: ctx.sender,
      };

      const l2Gas = await quoteL2Gas({ ctx, tx: L2tx });
      if (l2Gas) {
        L2tx.gas = l2Gas.gasLimit;
        L2tx.maxFeePerGas = l2Gas.maxFeePerGas;
        L2tx.maxPriorityFeePerGas = l2Gas.maxPriorityFeePerGas;
      }

      // Write-ready request
      const tx: ViemPlanWriteRequest = {
        address: L2_BASE_TOKEN_ADDRESS,
        abi: IBaseTokenABI,
        functionName: 'withdraw',
        args: [p.to ?? ctx.sender] as const,
        value: p.amount,
        account: ctx.client.account,
        ...l2Gas,
      } as const;

      const fees = buildFeeBreakdown({
        feeToken: L2_BASE_TOKEN_ADDRESS,
        l2Gas,
      });

      steps.push({
        key: 'l2-base-token:withdraw',
        kind: 'l2-base-token:withdraw',
        description: 'Withdraw ETH via L2 Base Token System',
        tx,
      });

      return { steps, approvals: [], fees };
    },
  };
}
