// src/adapters/ethers/resources/deposits/routes/eth-nonbase.ts

import type { DepositRouteStrategy } from './types';
import { Contract } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { IERC20ABI } from '../../../../../core/abi.ts';
import { encodeSecondBridgeEthArgs } from '../../utils';
import type { ApprovalNeed, PlanStep } from '../../../../../core/types/flows/base';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { isETH } from '../../../../../core/utils/addr';
import { quoteL1Gas, quoteL2Gas } from '../services/gas.ts';
import { quoteL2BaseCost } from '../services/fee.ts';
import { SAFE_L1_BRIDGE_GAS } from '../../../../../core/constants.ts';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';

// error handling
const { wrapAs } = createErrorHandlers('deposits');

// ETH deposit to a chain whose base token is NOT ETH.
export function routeEthNonBase(): DepositRouteStrategy {
  return {
    async preflight(p, ctx) {
      const resolved =
        ctx.resolvedToken ??
        (ctx.tokens ? await ctx.tokens.resolve(p.token, { chain: 'l1' }) : undefined);
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.ethNonBase.assertEthAsset,
        () => {
          if (resolved?.kind !== 'eth' && !isETH(p.token)) {
            throw new Error('eth-nonbase route requires ETH as the deposit asset.');
          }
        },
        { ctx: { token: p.token } },
      );
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.ethNonBase.assertNonEthBase,
        () => {
          if (ctx.baseIsEth) {
            throw new Error('eth-nonbase route requires target chain base token ≠ ETH.');
          }
        },
        { ctx: { baseIsEth: ctx.baseIsEth, chainIdL2: ctx.chainIdL2 } },
      );
      // Check sufficient ETH balance to cover deposit amount
      const ethBal = await wrapAs(
        'RPC',
        OP_DEPOSITS.ethNonBase.ethBalance,
        () => ctx.client.l1.getBalance(ctx.sender),
        {
          ctx: { where: 'l1.getBalance', sender: ctx.sender },
          message: 'Failed to read L1 ETH balance.',
        },
      );
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.ethNonBase.assertEthBalance,
        () => {
          if (ethBal < p.amount) {
            throw new Error('Insufficient L1 ETH balance to cover deposit amount.');
          }
        },
        { ctx: { required: p.amount.toString(), balance: ethBal.toString() } },
      );

      return;
    },

    async build(p, ctx) {
      const l1Signer = ctx.client.getL1Signer();
      const baseToken = ctx.baseTokenL1;

      // TX request created for gas estimation only
      const l2TxModel: TransactionRequest = {
        to: p.to ?? ctx.sender,
        from: ctx.sender,
        data: '0x',
        value: 0n,
      };
      const l2GasParams = await quoteL2Gas({
        ctx,
        route: 'eth-nonbase',
        l2TxForModeling: l2TxModel,
        overrideGasLimit: ctx.l2GasLimit,
      });
      if (!l2GasParams) throw new Error('Failed to estimate L2 gas parameters.');

      // L2TransactionBase cost
      const baseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2GasParams.gasLimit });
      const mintValue = baseCost + ctx.operatorTip;

      // --- Approvals ---
      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<TransactionRequest>[] = [];

      const erc20Base = new Contract(baseToken, IERC20ABI, l1Signer);
      const allowance = (await wrapAs(
        'RPC',
        OP_DEPOSITS.ethNonBase.allowanceBase,
        () => erc20Base.allowance(ctx.sender, ctx.l1AssetRouter),
        {
          ctx: { where: 'erc20.allowance', token: baseToken, spender: ctx.l1AssetRouter },
          message: 'Failed to read base-token allowance.',
        },
      )) as bigint;

      if (allowance < mintValue) {
        approvals.push({ token: baseToken, spender: ctx.l1AssetRouter, amount: mintValue });
        steps.push({
          key: `approve:${baseToken}`,
          kind: 'approve',
          description: `Approve base token for fees (mintValue)`,
          tx: {
            to: baseToken,
            data: erc20Base.interface.encodeFunctionData('approve', [ctx.l1AssetRouter, mintValue]),
            from: ctx.sender,
            ...ctx.gasOverrides,
          },
        });
      }

      const secondBridgeCalldata = await wrapAs(
        'INTERNAL',
        OP_DEPOSITS.ethNonBase.encodeCalldata,
        () => Promise.resolve(encodeSecondBridgeEthArgs(p.amount, p.to ?? ctx.sender)),
        {
          ctx: {
            where: 'encodeSecondBridgeEthArgs',
            amount: p.amount.toString(),
            to: p.to ?? ctx.sender,
          },
        },
      );

      const requestStruct = {
        chainId: ctx.chainIdL2,
        mintValue,
        l2Value: p.amount,
        l2GasLimit: l2GasParams.gasLimit,
        l2GasPerPubdataByteLimit: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        secondBridgeAddress: ctx.l1AssetRouter,
        secondBridgeValue: p.amount,
        secondBridgeCalldata,
      } as const;

      const bridgehub = await ctx.contracts.bridgehub();
      const data = bridgehub.interface.encodeFunctionData('requestL2TransactionTwoBridges', [
        requestStruct,
      ]);

      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data,
        value: p.amount, // base ≠ ETH ⇒ msg.value == secondBridgeValue
        from: ctx.sender,
        ...ctx.gasOverrides,
      };
      const l1GasParams = await quoteL1Gas({
        ctx,
        tx: l1TxCandidate,
        overrides: ctx.gasOverrides,
        fallbackGasLimit: SAFE_L1_BRIDGE_GAS,
      });
      if (l1GasParams) {
        l1TxCandidate.gasLimit = l1GasParams.gasLimit;
        l1TxCandidate.maxFeePerGas = l1GasParams.maxFeePerGas;
        l1TxCandidate.maxPriorityFeePerGas = l1GasParams.maxPriorityFeePerGas;
      }

      steps.push({
        key: 'bridgehub:two-bridges:eth-nonbase',
        kind: 'bridgehub:two-bridges',
        description:
          'Bridge ETH (fees in base ERC-20) via Bridgehub.requestL2TransactionTwoBridges',
        tx: l1TxCandidate,
      });

      const fees = buildFeeBreakdown({
        feeToken: baseToken,
        l1Gas: l1GasParams,
        l2Gas: l2GasParams,
        l2BaseCost: baseCost,
        operatorTip: ctx.operatorTip,
        mintValue,
      });

      return {
        steps,
        approvals,
        fees,
      };
    },
  };
}
