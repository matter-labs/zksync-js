// src/adapters/ethers/resources/deposits/routes/eth.ts

import type { TransactionRequest } from 'ethers';
import type { DepositRouteStrategy } from './types';
import { buildDirectRequestStruct } from '../../utils';
import type { PlanStep } from '../../../../../core/types/flows/base';
import { ETH_ADDRESS } from '../../../../../core/constants.ts';
import { quoteL2BaseCost } from '../services/fee.ts';
import { quoteL1Gas, quoteL2Gas } from '../services/gas.ts';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';
import { derivePriorityTxGasBreakdown } from '../../../../../core/resources/deposits/priority.ts';
import { getPriorityTxEncodedLength } from './priority';

const EMPTY_BYTES = '0x';

// ETH deposit route via Bridgehub.requestL2TransactionDirect
// ETH is base token
export function routeEthDirect(): DepositRouteStrategy {
  return {
    async build(p, ctx) {
      const bh = await ctx.contracts.bridgehub();
      const l2Contract = p.to ?? ctx.sender;
      const l2Value = p.amount;
      const l2Calldata = EMPTY_BYTES as `0x${string}`;

      const priorityFloorBreakdown = derivePriorityTxGasBreakdown({
        encodedLength: getPriorityTxEncodedLength({
          sender: ctx.sender,
          l2Contract,
          l2Value,
          l2Calldata,
          gasPerPubdata: ctx.gasPerPubdata,
        }),
        gasPerPubdata: ctx.gasPerPubdata,
      });

      const quotedL2GasLimit = ctx.l2GasLimit ?? priorityFloorBreakdown.derivedL2GasLimit;

      const l2GasParams = await quoteL2Gas({
        ctx,
        route: 'eth-base',
        overrideGasLimit: quotedL2GasLimit,
      });

      // TODO: proper error handling
      if (!l2GasParams) {
        throw new Error('Failed to estimate L2 gas for deposit.');
      }

      // L2TransactionBase cost
      const baseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2GasParams.gasLimit });
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

      const data = bh.interface.encodeFunctionData('requestL2TransactionDirect', [req]);

      // TX for estimating L1 gas
      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data,
        value: mintValue,
        from: ctx.sender,
        ...ctx.gasOverrides,
      };
      const l1GasParams = await quoteL1Gas({
        ctx,
        tx: l1TxCandidate,
        overrides: ctx.gasOverrides,
      });
      if (l1GasParams) {
        l1TxCandidate.gasLimit = l1GasParams.gasLimit;
        l1TxCandidate.maxFeePerGas = l1GasParams.maxFeePerGas;
        l1TxCandidate.maxPriorityFeePerGas = l1GasParams.maxPriorityFeePerGas;
      }

      const steps: PlanStep<TransactionRequest>[] = [
        {
          key: 'bridgehub:direct',
          kind: 'bridgehub:direct',
          description: 'Bridge ETH via Bridgehub.requestL2TransactionDirect',
          tx: l1TxCandidate,
        },
      ];

      const fees = buildFeeBreakdown({
        feeToken: ETH_ADDRESS,
        l1Gas: l1GasParams,
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
