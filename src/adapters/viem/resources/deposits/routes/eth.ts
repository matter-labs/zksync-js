// src/adapters/viem/resources/deposits/routes/eth.ts

import type { DepositRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep } from '../../../../../core/types/flows/base';
import { buildDirectRequestStruct, buildViemFeeOverrides } from '../../utils';
import { IBridgehubABI } from '../../../../../core/internal/abi-registry.ts';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';

// error handling
const { wrapAs } = createErrorHandlers('deposits');

// ETH deposit route via Bridgehub.requestL2TransactionDirect
// ETH is base token
export function routeEthDirect(): DepositRouteStrategy {
  return {
    async build(p, ctx) {
      const { gasPriceForBaseCost } = ctx.fee;
      const txFeeOverrides = buildViemFeeOverrides(ctx.fee);

      // base cost
      const rawBaseCost = await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.eth.baseCost,
        () =>
          ctx.client.l1.readContract({
            address: ctx.bridgehub,
            abi: IBridgehubABI,
            functionName: 'l2TransactionBaseCost',
            args: [ctx.chainIdL2, gasPriceForBaseCost, ctx.l2GasLimit, ctx.gasPerPubdata],
          }),
        {
          ctx: { where: 'l2TransactionBaseCost', chainIdL2: ctx.chainIdL2 },
          message: 'Could not fetch L2 base cost from Bridgehub.',
        },
      );
      const baseCost = rawBaseCost;

      const l2Contract = p.to ?? ctx.sender;
      const l2Value = p.amount;
      const mintValue = baseCost + ctx.operatorTip + l2Value;

      const req = buildDirectRequestStruct({
        chainId: ctx.chainIdL2,
        mintValue,
        l2GasLimit: ctx.l2GasLimit,
        gasPerPubdata: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        l2Contract,
        l2Value,
      });

      // Optional fee overrides for simulate/write
      // viem client requires these to be explicitly set
      // Simulate to produce a writeContract-ready request
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
      const resolvedL1GasLimit = sim.request.gas ?? ctx.l2GasLimit;
      // TODO: add preview step
      // right now it adds too much noise on response
      const steps: PlanStep<ViemPlanWriteRequest>[] = [
        {
          key: 'bridgehub:direct',
          kind: 'bridgehub:direct',
          description: 'Bridge ETH via Bridgehub.requestL2TransactionDirect',
          tx: { ...sim.request, ...txFeeOverrides },
        },
      ];

      return {
        steps,
        approvals: [],
        quoteExtras: { baseCost, mintValue, l1GasLimit: resolvedL1GasLimit },
      };
    },
  };
}
