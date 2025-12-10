// src/adapters/ethers/resources/withdrawals/routes/eth.ts
import { Contract, Interface, type TransactionRequest } from 'ethers';
import type { WithdrawRouteStrategy } from './types';
import type { PlanStep } from '../../../../../core/types/flows/base';
import { L2_BASE_TOKEN_ADDRESS } from '../../../../../core/constants';
import { IBaseTokenABI } from '../../../../../core/abi.ts';

import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_WITHDRAWALS } from '../../../../../core/types';

const { wrapAs } = createErrorHandlers('withdrawals');

// Route for withdrawing ETH via L2-L1
export function routeEthBase(): WithdrawRouteStrategy {
  return {
    async build(p, ctx) {
      const steps: Array<PlanStep<TransactionRequest>> = [];
      const { gasLimit: overrideGasLimit, maxFeePerGas, maxPriorityFeePerGas } = ctx.fee;

      const base = new Contract(
        L2_BASE_TOKEN_ADDRESS,

        new Interface(IBaseTokenABI),
        ctx.client.l2,
      );

      const toL1 = p.to ?? ctx.sender;
      const data = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.eth.encodeWithdraw,
        () => Promise.resolve(base.interface.encodeFunctionData('withdraw', [toL1])),
        {
          ctx: { where: 'L2BaseToken.withdraw', to: toL1 },
          message: 'Failed to encode ETH withdraw calldata.',
        },
      );

      const tx: TransactionRequest = {
        to: L2_BASE_TOKEN_ADDRESS,
        data,
        from: ctx.sender,
        value: p.amount,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };

      if (overrideGasLimit != null) {
        tx.gasLimit = overrideGasLimit;
      }

      steps.push({
        key: 'l2-base-token:withdraw',
        kind: 'l2-base-token:withdraw',
        description: 'Withdraw ETH via L2 Base Token System',
        tx,
      });

      return { steps, approvals: [], quoteExtras: {} };
    },
  };
}
