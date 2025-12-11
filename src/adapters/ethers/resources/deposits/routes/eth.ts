// src/adapters/ethers/resources/deposits/routes/eth.ts

import type { DepositRouteStrategy } from './types';
import { Contract } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { buildDirectRequestStruct } from '../../utils';
import { IBridgehubABI } from '../../../../../core/abi.ts';
import type { PlanStep } from '../../../../../core/types/flows/base';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { depositGasServices } from '../services/deposit-gas.service';
import { computeBaseCost } from '../services/deposit-fee.service';

// error handling
const { wrapAs } = createErrorHandlers('deposits');

// ETH deposit route via Bridgehub.requestL2TransactionDirect
// ETH is base token
export function routeEthDirect(): DepositRouteStrategy {
  return {
    async build(p, ctx) {
      const bh = new Contract(ctx.bridgehub, IBridgehubABI, ctx.client.l1);
      const { gasPriceForBaseCost, gasLimit: overrideGasLimit, ...txFeeOverrides } = ctx.fee;

      const l2Contract = p.to ?? ctx.sender;
      const l2Value = p.amount;
      const l2TxForModeling: TransactionRequest = {
        to: l2Contract,
        from: ctx.sender,
        data: '0x',
        value: l2Value,
      };
      const gasL2 = await depositGasServices.estimateL2Gas(
        ctx,
        'eth-base',
        l2TxForModeling,
        p.l2GasLimit ?? undefined,
      );
      if (gasL2 && !p.l2GasLimit) {
        ctx.l2GasLimit = gasL2.params.gasLimit;
        ctx.gasResolved = { ...(ctx.gasResolved ?? {}), l2: gasL2.params };
      }

      // base cost (after l2 gas resolved)
      const baseCost = await computeBaseCost({
        bridgehub: bh,
        op: OP_DEPOSITS.eth.baseCost,
        wrapAs,
        chainIdL2: ctx.chainIdL2,
        gasPriceForBaseCost,
        l2GasLimit: ctx.l2GasLimit,
        gasPerPubdata: ctx.gasPerPubdata,
      });

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

      const data = bh.interface.encodeFunctionData('requestL2TransactionDirect', [req]);
      let resolvedL1GasLimit: bigint = overrideGasLimit ?? ctx.l2GasLimit;
      const tx: TransactionRequest = {
        to: ctx.bridgehub,
        data,
        value: mintValue,
        from: ctx.sender,
        ...txFeeOverrides,
      };

      const gasL1 = await depositGasServices.estimateL1Gas(
        ctx,
        tx,
        p.l1TxOverrides?.gasLimit ?? undefined,
      );

      if (gasL1 && !p.l1TxOverrides?.gasLimit) {
        tx.gasLimit = gasL1.params.gasLimit;
        resolvedL1GasLimit = gasL1.params.gasLimit;
        ctx.gasResolved = { ...(ctx.gasResolved ?? {}), l1: gasL1.params };
      }

      if (overrideGasLimit != null) {
        tx.gasLimit = overrideGasLimit;
        resolvedL1GasLimit = overrideGasLimit;
      }
      const steps: PlanStep<TransactionRequest>[] = [
        {
          key: 'bridgehub:direct',
          kind: 'bridgehub:direct',
          description: 'Bridge ETH via Bridgehub.requestL2TransactionDirect',
          tx,
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
