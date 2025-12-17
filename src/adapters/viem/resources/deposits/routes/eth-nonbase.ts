// src/adapters/viem/resources/deposits/routes/eth-nonbase.ts

import type { DepositRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';
import { encodeFunctionData } from 'viem';
import type { Abi, TransactionRequest } from 'viem';

import { IBridgehubABI, IERC20ABI } from '../../../../../core/abi.ts';
import { encodeSecondBridgeEthArgs } from '../../utils';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { isETH } from '../../../../../core/utils/addr';
import { SAFE_L1_BRIDGE_GAS } from '../../../../../core/constants.ts';

import { quoteL2Gas, quoteL1Gas } from '../services/gas.ts';
import { quoteL2BaseCost } from '../services/fee.ts';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';

const { wrapAs } = createErrorHandlers('deposits');

// ETH deposit to a chain whose base token is NOT ETH.
export function routeEthNonBase(): DepositRouteStrategy {
  return {
    // TODO: do we even need these validations?
    async preflight(p, ctx) {
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.ethNonBase.assertEthAsset,
        () => {
          if (!isETH(p.token)) {
            throw new Error('eth-nonbase route requires ETH as the deposit asset.');
          }
        },
        { ctx: { token: p.token } },
      );
      const baseToken = await ctx.client.baseToken(ctx.chainIdL2);
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.ethNonBase.assertNonEthBase,
        () => {
          if (isETH(baseToken)) {
            throw new Error('eth-nonbase route requires target chain base token ≠ ETH.');
          }
        },
        { ctx: { baseToken, chainIdL2: ctx.chainIdL2 } },
      );
      // Check sufficient ETH balance to cover deposit amount
      const ethBal = await wrapAs(
        'RPC',
        OP_DEPOSITS.ethNonBase.ethBalance,
        () => ctx.client.l1.getBalance({ address: ctx.sender }),
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
    },

    async build(p, ctx) {
      const baseToken = await ctx.client.baseToken(ctx.chainIdL2);

      // TX request created for gas estimation only
      const l2TxModel: TransactionRequest = {
        to: p.to ?? ctx.sender,
        from: ctx.sender,
        data: '0x',
        value: 0n,
      };
      const l2Gas = await quoteL2Gas({
        ctx,
        route: 'eth-nonbase',
        l2TxForModeling: l2TxModel,
        overrideGasLimit: ctx.l2GasLimit,
      });

      if (!l2Gas) throw new Error('Failed to estimate L2 gas parameters.');

      // L2TransactionBase cost
      const l2BaseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2Gas.gasLimit });
      const mintValue = l2BaseCost + ctx.operatorTip;

      // -- Approvals --
      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<ViemPlanWriteRequest>[] = [];

      const allowance = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.ethNonBase.allowanceBase,
        () =>
          ctx.client.l1.readContract({
            address: baseToken,
            abi: IERC20ABI as Abi,
            functionName: 'allowance',
            args: [ctx.sender, ctx.l1AssetRouter],
          }),
        {
          ctx: { where: 'erc20.allowance', token: baseToken, spender: ctx.l1AssetRouter },
          message: 'Failed to read base-token allowance.',
        },
      )) as bigint;

      const needsApprove = allowance < mintValue;

      if (needsApprove) {
        const approveSim = await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.ethNonBase.estGas,
          () =>
            ctx.client.l1.simulateContract({
              address: baseToken,
              abi: IERC20ABI,
              functionName: 'approve',
              args: [ctx.l1AssetRouter, mintValue] as const,
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'l1.simulateContract', to: baseToken },
            message: 'Failed to simulate base-token approve.',
          },
        );

        approvals.push({ token: baseToken, spender: ctx.l1AssetRouter, amount: mintValue });
        steps.push({
          key: `approve:${baseToken}:${ctx.l1AssetRouter}`,
          kind: 'approve',
          description: `Approve base token for fees (mintValue)`,
          tx: { ...approveSim.request },
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
          message: 'Failed to encode ETH bridging calldata.',
        },
      );

      const requestStruct = {
        chainId: ctx.chainIdL2,
        mintValue,
        l2Value: p.amount,
        l2GasLimit: l2Gas.gasLimit,
        l2GasPerPubdataByteLimit: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        secondBridgeAddress: ctx.l1AssetRouter,
        secondBridgeValue: p.amount,
        secondBridgeCalldata,
      } as const;

      let bridgeTx: ViemPlanWriteRequest;
      let calldata: `0x${string}`;

      if (needsApprove) {
        bridgeTx = {
          address: ctx.bridgehub,
          abi: IBridgehubABI,
          functionName: 'requestL2TransactionTwoBridges',
          args: [requestStruct],
          value: p.amount, // base ≠ ETH ⇒ msg.value == secondBridgeValue
          account: ctx.client.account,
        } as const;

        calldata = encodeFunctionData({
          abi: IBridgehubABI as Abi,
          functionName: 'requestL2TransactionTwoBridges',
          args: [requestStruct],
        });
      } else {
        const sim = await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.ethNonBase.estGas,
          () =>
            ctx.client.l1.simulateContract({
              address: ctx.bridgehub,
              abi: IBridgehubABI,
              functionName: 'requestL2TransactionTwoBridges',
              args: [requestStruct],
              value: p.amount,
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'l1.simulateContract', to: ctx.bridgehub },
            message: 'Failed to simulate Bridgehub two-bridges request.',
          },
        );

        calldata = encodeFunctionData({
          abi: sim.request.abi as Abi,
          functionName: sim.request.functionName,
          args: sim.request.args,
        });

        bridgeTx = { ...sim.request };
      }

      // --- Estimate L1 Gas ---
      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data: calldata,
        value: p.amount,
        from: ctx.sender,
        ...ctx.gasOverrides,
      };
      const l1Gas = await quoteL1Gas({
        ctx,
        tx: l1TxCandidate,
        overrides: ctx.gasOverrides,
        fallbackGasLimit: SAFE_L1_BRIDGE_GAS,
      });

      if (l1Gas) {
        bridgeTx = {
          ...bridgeTx,
          gas: l1Gas.gasLimit,
          maxFeePerGas: l1Gas.maxFeePerGas,
          maxPriorityFeePerGas: l1Gas.maxPriorityFeePerGas,
        };
      }

      steps.push({
        key: 'bridgehub:two-bridges:eth-nonbase',
        kind: 'bridgehub:two-bridges',
        description:
          'Bridge ETH (fees in base ERC-20) via Bridgehub.requestL2TransactionTwoBridges',
        tx: bridgeTx,
      });

      const fees = buildFeeBreakdown({
        feeToken: baseToken,
        l1Gas,
        l2Gas,
        l2BaseCost,
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
