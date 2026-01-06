import type { WithdrawRouteStrategy, ViemPlanWriteRequest } from './types.ts';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base.ts';

import { IERC20ABI, L2NativeTokenVaultABI, IL2AssetRouterABI } from '../../../../../core/abi.ts';

import type { Abi, TransactionRequest } from 'viem';
import { encodeAbiParameters, encodeFunctionData } from 'viem';

import { createErrorHandlers } from '../../../errors/error-ops.ts';
import { OP_WITHDRAWALS } from '../../../../../core/types/index.ts';

import { quoteL2Gas } from '../services/gas.ts';
import { buildFeeBreakdown } from '../services/fee.ts';

const { wrapAs } = createErrorHandlers('withdrawals');

// Route for withdrawing ERC-20 via L2-L1
export function routeErc20NonBase(): WithdrawRouteStrategy {
  return {
    // TODO: add preflight validations here
    async build(p, ctx) {
      const steps: Array<PlanStep<ViemPlanWriteRequest>> = [];
      const approvals: ApprovalNeed[] = [];

      // L2 allowance
      const current = (await wrapAs(
        'CONTRACT',
        OP_WITHDRAWALS.erc20.allowance,
        () =>
          ctx.client.l2.readContract({
            address: p.token,
            abi: IERC20ABI as Abi,
            functionName: 'allowance',
            args: [ctx.sender, ctx.l2NativeTokenVault],
            account: ctx.client.account,
          }),
        {
          ctx: {
            where: 'erc20.allowance',
            chain: 'L2',
            token: p.token,
            spender: ctx.l2NativeTokenVault,
          },
          message: 'Failed to read L2 ERC-20 allowance.',
        },
      )) as bigint;

      if (current < p.amount) {
        approvals.push({ token: p.token, spender: ctx.l2NativeTokenVault, amount: p.amount });

        const data = encodeFunctionData({
          abi: IERC20ABI as Abi,
          functionName: 'approve',
          args: [ctx.l2NativeTokenVault, p.amount] as const,
        });

        const approveTxCandidate: TransactionRequest = {
          to: p.token,
          data: data,
          value: 0n,
          from: ctx.sender,
        };

        const approveGas = await quoteL2Gas({ ctx, tx: approveTxCandidate });
        if (approveGas) {
          approveTxCandidate.gas = approveGas.gasLimit;
          approveTxCandidate.maxFeePerGas = approveGas.maxFeePerGas;
          approveTxCandidate.maxPriorityFeePerGas = approveGas.maxPriorityFeePerGas;
        }

        // Use simulateContract only to produce a write-ready request object
        const approveSim = await wrapAs(
          'CONTRACT',
          OP_WITHDRAWALS.erc20.estGas,
          () =>
            ctx.client.l2.simulateContract({
              address: p.token,
              abi: IERC20ABI,
              functionName: 'approve',
              args: [ctx.l2NativeTokenVault, p.amount] as const,
              account: ctx.client.account,
              ...approveGas,
            }),
          {
            ctx: { where: 'l2.simulateContract', to: p.token },
            message: 'Failed to simulate L2 ERC-20 approve.',
          },
        );

        const { ...approveRequest } = approveSim.request;
        const approveTx: ViemPlanWriteRequest = {
          ...approveRequest,
        };

        steps.push({
          key: `approve:l2:${p.token}:${ctx.l2NativeTokenVault}`,
          kind: 'approve:l2',
          description: `Approve ${p.amount} to NativeTokenVault`,
          tx: approveTx,
        });
      }

      const resolved =
        ctx.resolvedToken ??
        (ctx.tokens ? await ctx.tokens.resolve(p.token, { chain: 'l2' }) : undefined);
      const assetId =
        resolved?.assetId ??
        (await wrapAs(
          'CONTRACT',
          OP_WITHDRAWALS.erc20.ensureRegistered,
          () =>
            ctx.client.l2.simulateContract({
              address: ctx.l2NativeTokenVault,
              abi: L2NativeTokenVaultABI,
              functionName: 'ensureTokenIsRegistered',
              args: [p.token] as const,
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'L2NativeTokenVault.ensureTokenIsRegistered', token: p.token },
            message: 'Failed to ensure token is registered in L2NativeTokenVault.',
          },
        )).result;
      const assetData = encodeAbiParameters(
        [
          { type: 'uint256', name: 'amount' },
          { type: 'address', name: 'l1Receiver' },
          { type: 'address', name: 'l2Token' },
        ],
        [p.amount, p.to ?? ctx.sender, p.token],
      );

      // L2AssetRouter.withdraw(assetId, assetData)
      const withdrawCalldata = encodeFunctionData({
        abi: IL2AssetRouterABI as Abi,
        functionName: 'withdraw',
        args: [assetId, assetData] as const,
      });
      const withdrawTxCandidate: TransactionRequest = {
        to: ctx.l2AssetRouter,
        data: withdrawCalldata,
        value: 0n,
        from: ctx.sender,
      };

      const withdrawGas = await quoteL2Gas({ ctx, tx: withdrawTxCandidate });
      if (withdrawGas) {
        withdrawTxCandidate.gas = withdrawGas.gasLimit;
        withdrawTxCandidate.maxFeePerGas = withdrawGas.maxFeePerGas;
        withdrawTxCandidate.maxPriorityFeePerGas = withdrawGas.maxPriorityFeePerGas;
      }

      let withdrawTx: ViemPlanWriteRequest;

      if (current < p.amount) {
        // Do NOT simulate (can revert prior to approve). Return raw write params.
        withdrawTx = {
          address: ctx.l2AssetRouter,
          abi: IL2AssetRouterABI,
          functionName: 'withdraw',
          args: [assetId, assetData] as const,
          account: ctx.client.account,
          ...withdrawGas,
        } satisfies ViemPlanWriteRequest;
      } else {
        const sim = await wrapAs(
          'CONTRACT',
          OP_WITHDRAWALS.erc20.estGas,
          () =>
            ctx.client.l2.simulateContract({
              address: ctx.l2AssetRouter,
              abi: IL2AssetRouterABI,
              functionName: 'withdraw',
              args: [assetId, assetData] as const,
              account: ctx.client.account,
              ...withdrawGas,
            }),
          {
            ctx: { where: 'l2.simulateContract', to: ctx.l2AssetRouter },
            message: 'Failed to simulate L2 ERC-20 withdraw.',
          },
        );

        const { ...withdrawRequest } = sim.request;
        withdrawTx = {
          ...withdrawRequest,
          ...withdrawGas,
        };
      }

      steps.push({
        key: 'l2-asset-router:withdraw',
        kind: 'l2-asset-router:withdraw',
        description: 'Burn on L2 & send L2→L1 message',
        tx: withdrawTx,
      });

      const fees = buildFeeBreakdown({
        feeToken: ctx.baseTokenL1 ?? (await ctx.client.baseToken(ctx.chainIdL2)),
        l2Gas: withdrawGas,
      });

      return { steps, approvals, fees };
    },
  };
}
