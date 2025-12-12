// src/adapters/ethers/resources/withdrawals/routes/eth.ts

import { type TransactionRequest } from 'ethers';
import type { WithdrawRouteStrategy } from './types';
import type { PlanStep } from '../../../../../core/types/flows/base';
import { L2_BASE_TOKEN_ADDRESS } from '../../../../../core/constants';

import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_WITHDRAWALS } from '../../../../../core/types';
import { quoteL2Gas } from '../services/gas.ts';
import { buildFeeBreakdown } from '../services/fees.ts';

const { wrapAs } = createErrorHandlers('withdrawals');

// Route for withdrawing ETH via L2-L1
export function routeEthBase(): WithdrawRouteStrategy {
  return {
    async build(p, ctx) {
      const steps: Array<PlanStep<TransactionRequest>> = [];

      const base = (await ctx.client.contracts()).l2BaseTokenSystem;
      const data = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.eth.encodeWithdraw,
        () => Promise.resolve(base.interface.encodeFunctionData('withdraw', [p.to ?? ctx.sender])),
        {
          ctx: { where: 'L2BaseToken.withdraw', to: p.to ?? ctx.sender },
          message: 'Failed to encode ETH withdraw calldata.',
        },
      );

      const tx: TransactionRequest = {
        to: L2_BASE_TOKEN_ADDRESS,
        data,
        from: ctx.sender,
        value: p.amount,
      };

      const gas = await quoteL2Gas({ ctx, tx });

      if (gas) {
        tx.gasLimit = gas.gasLimit;
        tx.maxFeePerGas = gas.maxFeePerGas;
        tx.maxPriorityFeePerGas = gas.maxPriorityFeePerGas;
      }

      const fees = buildFeeBreakdown({
        feeToken: L2_BASE_TOKEN_ADDRESS,
        l2Gas: gas,
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
