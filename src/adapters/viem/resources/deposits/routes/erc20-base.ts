// src/adapters/viem/resources/deposits/routes/erc20-base.ts

import type { DepositRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';

import { encodeFunctionData } from 'viem';
import type { Abi, TransactionRequest } from 'viem';

import { IBridgehubABI, IERC20ABI } from '../../../../../core/abi.ts';
import { buildDirectRequestStruct } from '../../utils';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { normalizeAddrEq, isETH } from '../../../../../core/utils/addr';
import { SAFE_L1_BRIDGE_GAS } from '../../../../../core/constants.ts';

import { quoteL2Gas, quoteL1Gas } from '../services/gas.ts';
import { quoteL2BaseCost } from '../services/fee.ts';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';

const { wrapAs } = createErrorHandlers('deposits');

// ERC20 deposit where the deposit token IS the target chain's base token (base ≠ ETH).
export function routeErc20Base(): DepositRouteStrategy {
  return {
    async preflight(p, ctx) {
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.base.assertErc20Asset,
        () => {
          if (ctx.resolvedToken?.kind === 'eth' || isETH(p.token)) {
            throw new Error('erc20-base route requires an ERC-20 token (not ETH).');
          }
        },
        { ctx: { token: p.token } },
      );
      const baseToken = ctx.baseTokenL1 ?? (await ctx.client.baseToken(ctx.chainId));

      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.base.assertMatchesBase,
        () => {
          if (!normalizeAddrEq(baseToken, p.token)) {
            throw new Error('Provided token is not the base token for the target chain.');
          }
        },
        { ctx: { baseToken, provided: p.token, chainId: ctx.chainId } },
      );
    },

    async build(p, ctx) {
      const baseToken = ctx.baseTokenL1 ?? (await ctx.client.baseToken(ctx.chainId));

      // TX request created for gas estimation only
      const l2TxModel: TransactionRequest = {
        to: p.to ?? ctx.sender,
        from: ctx.sender,
        data: '0x',
        value: 0n,
      };
      const l2Gas = await quoteL2Gas({
        ctx,
        route: 'erc20-base',
        l2TxForModeling: l2TxModel,
        overrideGasLimit: ctx.l2GasLimit,
      });

      if (!l2Gas) throw new Error('Failed to estimate L2 gas parameters.');

      // L2TransactionBase cost
      const l2BaseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2Gas.gasLimit });
      const mintValue = l2BaseCost + ctx.operatorTip + p.amount;

      // -- Approvals --
      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<ViemPlanWriteRequest>[] = [];

      const allowance = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.base.allowance,
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
          OP_DEPOSITS.base.estGas,
          () =>
            ctx.client.l1.simulateContract({
              address: baseToken,
              abi: IERC20ABI as Abi,
              functionName: 'approve',
              args: [ctx.l1AssetRouter, mintValue] as const,
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'l1.simulateContract', to: baseToken },
            message: 'Failed to simulate ERC-20 approve.',
          },
        );

        approvals.push({ token: baseToken, spender: ctx.l1AssetRouter, amount: mintValue });
        steps.push({
          key: `approve:${baseToken}:${ctx.l1AssetRouter}`,
          kind: 'approve',
          description: 'Approve base token for mintValue',
          tx: { ...approveSim.request },
        });
      }

      const req = buildDirectRequestStruct({
        chainId: ctx.chainId,
        mintValue,
        l2GasLimit: l2Gas.gasLimit,
        gasPerPubdata: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        l2Contract: p.to ?? ctx.sender,
        l2Value: p.amount,
      });

      let bridgeTx: ViemPlanWriteRequest;
      let calldata: `0x${string}`;

      if (needsApprove) {
        bridgeTx = {
          address: ctx.bridgehub,
          abi: IBridgehubABI,
          functionName: 'requestL2TransactionDirect',
          args: [req],
          value: 0n, // base token is ERC-20 ⇒ msg.value MUST be 0
          account: ctx.client.account,
        } as const;

        calldata = encodeFunctionData({
          abi: IBridgehubABI as Abi,
          functionName: 'requestL2TransactionDirect',
          args: [req],
        });
      } else {
        const sim = await wrapAs(
          'RPC',
          OP_DEPOSITS.base.estGas,
          () =>
            ctx.client.l1.simulateContract({
              address: ctx.bridgehub,
              abi: IBridgehubABI as Abi,
              functionName: 'requestL2TransactionDirect',
              args: [req],
              value: 0n,
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'l1.simulateContract', to: ctx.bridgehub },
            message: 'Failed to simulate Bridgehub.requestL2TransactionDirect.',
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
        value: 0n,
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
        key: 'bridgehub:direct:erc20-base',
        kind: 'bridgehub:direct',
        description: 'Bridge base ERC-20 via Bridgehub.requestL2TransactionDirect',
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
