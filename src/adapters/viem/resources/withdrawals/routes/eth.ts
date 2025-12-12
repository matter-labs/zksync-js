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
      const toL1 = p.to ?? ctx.sender;
      const gasOverrides =
        ctx.gasOverrides != null
          ? {
              gas: ctx.gasOverrides.gasLimit,
              maxFeePerGas: ctx.gasOverrides.maxFeePerGas,
              ...(ctx.gasOverrides.maxPriorityFeePerGas != null
                ? { maxPriorityFeePerGas: ctx.gasOverrides.maxPriorityFeePerGas }
                : {}),
            }
          : {};

      // Encode calldata explicitly (mirrors ethers behavior)
      const calldata = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.eth.encodeWithdraw,
        () =>
          Promise.resolve(
            encodeFunctionData({
              abi: IBaseTokenABI as Abi,
              functionName: 'withdraw',
              args: [toL1] as const,
            }),
          ),
        {
          ctx: { where: 'IBaseToken.withdraw', to: toL1 },
          message: 'Failed to encode ETH withdraw calldata.',
        },
      );

      // Candidate tx for gas quoting (viem estimateGas likes `account`)
      const l2TxCandidate: TransactionRequest = {
        to: L2_BASE_TOKEN_ADDRESS,
        data: calldata,
        value: p.amount,
        // important for zkSync/viem estimateGas
        from: ctx.sender,
        ...gasOverrides,
      };

      const l2Gas = await quoteL2Gas({ ctx, tx: l2TxCandidate });

      // Write-ready request
      let tx: ViemPlanWriteRequest = {
        address: L2_BASE_TOKEN_ADDRESS,
        abi: IBaseTokenABI,
        functionName: 'withdraw',
        args: [toL1] as const,
        value: p.amount,
        account: ctx.client.account,
        ...gasOverrides,
      } as const;

      // Apply quoted gas fields if available
      if (l2Gas) {
        tx = {
          ...tx,
          gas: l2Gas.gasLimit,
          maxFeePerGas: l2Gas.maxFeePerGas,
          maxPriorityFeePerGas: l2Gas.maxPriorityFeePerGas,
        };
      }

      const fees = buildFeeBreakdown({
        feeToken: L2_BASE_TOKEN_ADDRESS,
        l2Gas,
      });

      const steps: Array<PlanStep<ViemPlanWriteRequest>> = [
        {
          key: 'l2-base-token:withdraw',
          kind: 'l2-base-token:withdraw',
          description: 'Withdraw ETH via L2 Base Token System',
          tx,
        },
      ];

      return { steps, approvals: [], fees };
    },
  };
}
