// src/adapters/viem/resources/deposits/routes/erc20-nonbase.ts

import type { Abi, TransactionRequest } from 'viem';
import { encodeFunctionData } from 'viem';

import type { DepositRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';

import { IERC20ABI, IBridgehubABI } from '../../../../../core/abi.ts';
import { encodeSecondBridgeErc20Args } from '../../utils';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { isETH, normalizeAddrEq } from '../../../../../core/utils/addr';
import { SAFE_L1_BRIDGE_GAS } from '../../../../../core/constants.ts';

import { quoteL1Gas, determineErc20L2Gas } from '../services/gas.ts';
import { quoteL2BaseCost, buildFeeBreakdown } from '../services/fee.ts';

const { wrapAs } = createErrorHandlers('deposits');

export function routeErc20NonBase(): DepositRouteStrategy {
  return {
    async preflight(p, ctx) {
      // Must be ERC-20
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.nonbase.assertNotEthAsset,
        () => {
          if (isETH(p.token)) {
            throw new Error('erc20-nonbase route requires an ERC-20 token (not ETH).');
          }
        },
        { ctx: { token: p.token } },
      );

      // Deposit token must not equal base token
      const baseToken = await ctx.client.baseToken(ctx.chainIdL2);

      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.nonbase.assertNonBaseToken,
        () => {
          if (normalizeAddrEq(baseToken, p.token)) {
            throw new Error('erc20-nonbase route requires a non-base ERC-20 deposit token.');
          }
        },
        { ctx: { depositToken: p.token, baseToken } },
      );
    },

    async build(p, ctx) {
      // 1) Resolve base token + who pays fees
      const baseToken = await ctx.client.baseToken(ctx.chainIdL2);

      const baseIsEth = isETH(baseToken);
      const assetRouter = ctx.l1AssetRouter;

      // 2) Determine L2 gas (deployment-aware)
      const l2Gas = await determineErc20L2Gas({
        ctx,
        l1Token: p.token,
        modelTx: {
          to: p.to ?? ctx.sender,
          from: ctx.sender,
          data: '0x',
          value: 0n,
        } as TransactionRequest,
      });

      if (!l2Gas) throw new Error('Failed to establish L2 gas parameters.');

      // 3) Base cost + mintValue (no buffering)
      const l2BaseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2Gas.gasLimit });
      const mintValue = l2BaseCost + ctx.operatorTip;

      // 4) Approvals
      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<ViemPlanWriteRequest>[] = [];

      // 4a) Deposit token approval for amount
      const depositAllowance = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.nonbase.allowanceToken,
        () =>
          ctx.client.l1.readContract({
            address: p.token,
            abi: IERC20ABI as Abi,
            functionName: 'allowance',
            args: [ctx.sender, assetRouter],
          }),
        {
          ctx: { where: 'erc20.allowance', token: p.token, spender: assetRouter },
          message: 'Failed to read deposit-token allowance.',
        },
      )) as bigint;

      if (depositAllowance < p.amount) {
        const approveSim = await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.nonbase.estGas,
          () =>
            ctx.client.l1.simulateContract({
              address: p.token,
              abi: IERC20ABI as Abi,
              functionName: 'approve',
              args: [assetRouter, p.amount] as const,
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'l1.simulateContract', to: p.token },
            message: 'Failed to simulate deposit token approve.',
          },
        );

        approvals.push({ token: p.token, spender: assetRouter, amount: p.amount });
        steps.push({
          key: `approve:${p.token}:${assetRouter}`,
          kind: 'approve',
          description: `Approve deposit token for amount`,
          tx: { ...approveSim.request },
        });
      }

      // 4b) If fees are paid in base ERC-20 (base != ETH), ensure base-token approval for mintValue
      if (!baseIsEth) {
        const baseAllowance = (await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.nonbase.allowanceBase,
          () =>
            ctx.client.l1.readContract({
              address: baseToken,
              abi: IERC20ABI as Abi,
              functionName: 'allowance',
              args: [ctx.sender, assetRouter],
            }),
          {
            ctx: { where: 'erc20.allowance', token: baseToken, spender: assetRouter },
            message: 'Failed to read base-token allowance.',
          },
        )) as bigint;

        if (baseAllowance < mintValue) {
          const approveBaseSim = await wrapAs(
            'CONTRACT',
            OP_DEPOSITS.nonbase.estGas,
            () =>
              ctx.client.l1.simulateContract({
                address: baseToken,
                abi: IERC20ABI as Abi,
                functionName: 'approve',
                args: [assetRouter, mintValue] as const,
                account: ctx.client.account,
              }),
            {
              ctx: { where: 'l1.simulateContract', to: baseToken },
              message: 'Failed to simulate base token approve.',
            },
          );

          approvals.push({ token: baseToken, spender: assetRouter, amount: mintValue });
          steps.push({
            key: `approve:${baseToken}:${assetRouter}`,
            kind: 'approve',
            description: `Approve base token for mintValue`,
            tx: { ...approveBaseSim.request },
          });
        }
      }

      // 5) Two-bridges calldata + request struct
      const secondBridgeCalldata = await wrapAs(
        'INTERNAL',
        OP_DEPOSITS.nonbase.encodeCalldata,
        () => Promise.resolve(encodeSecondBridgeErc20Args(p.token, p.amount, p.to ?? ctx.sender)),
        {
          ctx: {
            where: 'encodeSecondBridgeErc20Args',
            token: p.token,
            amount: p.amount.toString(),
          },
          message: 'Failed to encode bridging calldata.',
        },
      );

      const requestStruct = {
        chainId: ctx.chainIdL2,
        mintValue,
        l2Value: 0n,
        l2GasLimit: l2Gas.gasLimit,
        l2GasPerPubdataByteLimit: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        secondBridgeAddress: assetRouter,
        secondBridgeValue: 0n,
        secondBridgeCalldata,
      } as const;

      // msg.value: if base is ETH -> mintValue, else 0
      const msgValue = baseIsEth ? mintValue : 0n;

      // 6) Build calldata for L1 gas quote
      const calldata = encodeFunctionData({
        abi: IBridgehubABI as Abi,
        functionName: 'requestL2TransactionTwoBridges',
        args: [requestStruct],
      });

      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data: calldata,
        value: msgValue,
        from: ctx.sender,
        ...ctx.gasOverrides,
      };

      const l1Gas = await quoteL1Gas({
        ctx,
        tx: l1TxCandidate,
        overrides: ctx.gasOverrides,
        fallbackGasLimit: SAFE_L1_BRIDGE_GAS,
      });

      // 7) Bridge step tx: simulate only if no approvals are required
      const approvalsNeeded = approvals.length > 0;

      let bridgeTx: ViemPlanWriteRequest;
      if (approvalsNeeded) {
        bridgeTx = {
          address: ctx.bridgehub,
          abi: IBridgehubABI,
          functionName: 'requestL2TransactionTwoBridges',
          args: [requestStruct],
          value: msgValue,
          account: ctx.client.account,
        } as const;
      } else {
        const sim = await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.nonbase.estGas,
          () =>
            ctx.client.l1.simulateContract({
              address: ctx.bridgehub,
              abi: IBridgehubABI as Abi,
              functionName: 'requestL2TransactionTwoBridges',
              args: [requestStruct],
              value: msgValue,
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'l1.simulateContract', to: ctx.bridgehub },
            message: 'Failed to simulate two-bridges request.',
          },
        );

        bridgeTx = { ...sim.request };
      }

      // Apply quoted L1 gas fields onto the bridge write request (if available)
      if (l1Gas) {
        bridgeTx = {
          ...bridgeTx,
          gas: l1Gas.gasLimit,
          maxFeePerGas: l1Gas.maxFeePerGas,
          maxPriorityFeePerGas: l1Gas.maxPriorityFeePerGas,
        };
      }

      steps.push({
        key: 'bridgehub:two-bridges:erc20-nonbase',
        kind: 'bridgehub:two-bridges',
        description: baseIsEth
          ? 'Bridge ERC-20 (fees in ETH) via Bridgehub.requestL2TransactionTwoBridges'
          : 'Bridge ERC-20 (fees in base ERC-20) via Bridgehub.requestL2TransactionTwoBridges',
        tx: bridgeTx,
      });

      // 8) Fees
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
