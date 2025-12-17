// src/adapters/viem/resources/deposits/routes/eth.ts

import type { TransactionRequest } from 'viem';
import { encodeFunctionData } from 'viem';
import type { DepositRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep } from '../../../../../core/types/flows/base';
import { buildDirectRequestStruct } from '../../utils';
import { IBridgehubABI } from '../../../../../core/abi.ts';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { quoteL2Gas, quoteL1Gas } from '../services/gas.ts';
import { quoteL2BaseCost } from '../services/fee.ts';
import { ETH_ADDRESS } from '../../../../../core/constants.ts';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';

// error handling
const { wrapAs } = createErrorHandlers('deposits');

// ETH deposit route via Bridgehub.requestL2TransactionDirect
// ETH is base token
export function routeEthDirect(): DepositRouteStrategy {
  return {
    async build(p, ctx) {
      const l2TxModel: TransactionRequest = {
        to: p.to ?? ctx.sender,
        from: ctx.sender,
        data: '0x',
        value: p.amount,
      };
      const l2GasParams = await quoteL2Gas({
        ctx,
        route: 'eth-base',
        l2TxForModeling: l2TxModel,
        overrideGasLimit: ctx.l2GasLimit,
        stateOverrides: {
          [ctx.sender]: {
            balance: '0xffffffffffffffffffff',
          },
        },
      });
      // TODO: proper error handling
      if (!l2GasParams) {
        throw new Error('Failed to estimate L2 gas for deposit.');
      }

      // L2TransactionBase cost
      const baseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2GasParams.gasLimit });

      const l2Contract = p.to ?? ctx.sender;
      const l2Value = p.amount;
      const mintValue = baseCost + ctx.operatorTip + l2Value;

      const req = buildDirectRequestStruct({
        chainId: ctx.chainIdL2,
        mintValue,
        l2GasLimit: l2GasParams.gasLimit,
        gasPerPubdata: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        l2Contract,
        l2Value,
      });

      // Optional fee overrides for simulate/write
      // viem client requires these to be explicitly set
      // Simulate to produce a writeContract-ready request
      // TODO: probably can remove l1GasQuote
      const sim = await wrapAs(
        'RPC',
        OP_DEPOSITS.eth.estGas,
        () =>
          ctx.client.l1.simulateContract({
            address: ctx.bridgehub,
            abi: IBridgehubABI,
            functionName: 'requestL2TransactionDirect',
            args: [req],
            value: mintValue,
            account: ctx.client.account,
          }),
        {
          ctx: { where: 'l1.simulateContract', to: ctx.bridgehub },
          message: 'Failed to simulate Bridgehub.requestL2TransactionDirect.',
        },
      );
      const data = encodeFunctionData({
        abi: sim.request.abi,
        functionName: sim.request.functionName,
        args: sim.request.args,
      });
      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data,
        value: mintValue,
        from: ctx.sender,
        ...ctx.gasOverrides,
      };
      const l1Gas = await quoteL1Gas({
        ctx,
        tx: l1TxCandidate,
        overrides: ctx.gasOverrides,
      });

      const steps: PlanStep<ViemPlanWriteRequest>[] = [
        {
          key: 'bridgehub:direct',
          kind: 'bridgehub:direct',
          description: 'Bridge ETH via Bridgehub.requestL2TransactionDirect',
          tx: { ...sim.request, ...l1Gas },
        },
      ];

      const fees = buildFeeBreakdown({
        feeToken: ETH_ADDRESS,
        l1Gas: l1Gas,
        l2Gas: l2GasParams,
        l2BaseCost: baseCost,
        operatorTip: ctx.operatorTip,
        mintValue,
      });

      return {
        steps,
        approvals: [],
        fees,
      };
    },
  };
}
