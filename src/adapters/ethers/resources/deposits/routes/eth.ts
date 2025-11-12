// src/adapters/ethers/resources/deposits/routes/eth.ts

import type { DepositRouteStrategy } from './types';
import { Contract } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { buildDirectRequestStruct } from '../../utils';
import { IBridgehubABI } from '../../../../../core/internal/abi-registry.ts';
import type { PlanStep } from '../../../../../core/types/flows/base';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';

// error handling
const { wrapAs } = createErrorHandlers('deposits');

// ETH deposit route via Bridgehub.requestL2TransactionDirect
// ETH is base token
export function routeEthDirect(): DepositRouteStrategy {
  return {
    async build(p, ctx) {
      const bh = new Contract(ctx.bridgehub, IBridgehubABI, ctx.client.l1);
      const { gasPriceForBaseCost, gasLimit: overrideGasLimit, ...txFeeOverrides } = ctx.fee;

      // base cost
      const rawBaseCost: bigint = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.eth.baseCost,
        () =>
          bh.l2TransactionBaseCost(
            ctx.chainIdL2,
            gasPriceForBaseCost,
            ctx.l2GasLimit,
            ctx.gasPerPubdata,
          ),
        {
          ctx: { where: 'l2TransactionBaseCost', chainIdL2: ctx.chainIdL2 },
          message: 'Could not fetch L2 base cost from Bridgehub.',
        },
      )) as bigint;
      const baseCost = BigInt(rawBaseCost);

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

      const data = bh.interface.encodeFunctionData('requestL2TransactionDirect', [req]);
      let resolvedL1GasLimit: bigint = overrideGasLimit ?? ctx.l2GasLimit;
      const tx: TransactionRequest = {
        to: ctx.bridgehub,
        data,
        value: mintValue,
        from: ctx.sender,
        ...txFeeOverrides,
      };
      if (overrideGasLimit != null) {
        tx.gasLimit = overrideGasLimit;
        resolvedL1GasLimit = overrideGasLimit;
      } else {
        try {
          const est = await wrapAs(
            'RPC',
            OP_DEPOSITS.eth.estGas,
            () => ctx.client.l1.estimateGas(tx),
            {
              ctx: { where: 'l1.estimateGas', to: ctx.bridgehub },
              message: 'Failed to estimate gas for Bridgehub request.',
            },
          );
          const buffered = (BigInt(est) * 115n) / 100n;
          tx.gasLimit = buffered;
          resolvedL1GasLimit = buffered;
        } catch {
          // ignore
        }
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
