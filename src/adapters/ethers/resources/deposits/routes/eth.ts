// src/adapters/ethers/resources/deposits/routes/eth.ts

import type { DepositRouteStrategy } from './types';
import { Contract } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { buildDirectRequestStruct } from '../../utils';
import { IBridgehubABI } from '../../../../../core/abi.ts';
import type { PlanStep } from '../../../../../core/types/flows/base';
import { ETH_ADDRESS } from '../../../../../core/constants.ts';
import { buildFeeBreakdown, quoteL2BaseCost } from '../services/fee.ts';
import { quoteL1Gas, quoteL2Gas } from '../services/gas.ts';

// ETH deposit route via Bridgehub.requestL2TransactionDirect
// ETH is base token
export function routeEthDirect(): DepositRouteStrategy {
  return {
    async build(p, ctx) {
      const bh = new Contract(ctx.bridgehub, IBridgehubABI, ctx.client.l1);

      // ---------------------------------------------------------
      // Step 1: Estimate L2 Gas
      // ---------------------------------------------------------
      // We need L2 gas first because it determines the Base Cost.
      // We pass `ctx.l2GasLimit` which commonCtx loaded from user params.

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
      });
      // TODO: proper error handling
      if (!l2GasParams) {
        throw new Error('Failed to estimate L2 gas for deposit.');
      }

      // ---------------------------------------------------------
      // Step 2: Calculate Base Cost & Mint Value
      // ---------------------------------------------------------
      // Now that we have the L2 limit, we calculate how much ETH
      // must be sent to the bridge (Base Cost).

      // base cost
      const baseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2GasParams.gasLimit });
      const mintValue = baseCost + ctx.operatorTip + p.amount;

      const req = buildDirectRequestStruct({
        chainId: ctx.chainIdL2,
        mintValue,
        l2GasLimit: l2GasParams.gasLimit,
        gasPerPubdata: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        l2Contract: p.to ?? ctx.sender,
        l2Value: p.amount,
      });

      const data = bh.interface.encodeFunctionData('requestL2TransactionDirect', [req]);

      // Tx for estimating L1 gas
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
