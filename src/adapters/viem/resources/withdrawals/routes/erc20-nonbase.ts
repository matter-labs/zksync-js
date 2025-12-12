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
      const toL1 = p.to ?? ctx.sender;

      // ---------------------------------------------------------------------
      // 1) L2 allowance (deposit token -> NativeTokenVault)
      // ---------------------------------------------------------------------
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

      const needsApprove = current < p.amount;

      const steps: Array<PlanStep<ViemPlanWriteRequest>> = [];
      const approvals: ApprovalNeed[] = [];

      const gasOverrides =
        ctx.gasOverrides != null
          ? {
              gas: ctx.gasOverrides.gasLimit,
              maxFeePerGas: ctx.gasOverrides.maxFeePerGas,
              ...(ctx.gasOverrides.maxPriorityFeePerGas != null
                ? { maxPriorityFeePerGas: ctx.gasOverrides.maxPriorityFeePerGas }
                : {}),
            }
          : {};

      // ---------------------------------------------------------------------
      // 2) Optional approve step (ERC20.approve(NativeTokenVault, amount))
      //    - We still quote gas properly via quoteL2Gas using calldata.
      // ---------------------------------------------------------------------
      if (needsApprove) {
        approvals.push({ token: p.token, spender: ctx.l2NativeTokenVault, amount: p.amount });

        // Quote gas from calldata (works even if we skip simulate elsewhere)
        const approveCalldata = encodeFunctionData({
          abi: IERC20ABI as Abi,
          functionName: 'approve',
          args: [ctx.l2NativeTokenVault, p.amount] as const,
        });

        const approveTxCandidate: TransactionRequest = {
          to: p.token,
          data: approveCalldata,
          value: 0n,
          from: ctx.sender,
          ...gasOverrides,
        };

        const approveGas = await quoteL2Gas({ ctx, tx: approveTxCandidate });

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
              ...gasOverrides,
            }),
          {
            ctx: { where: 'l2.simulateContract', to: p.token },
            message: 'Failed to simulate L2 ERC-20 approve.',
          },
        );

        const { ...approveRequest } = approveSim.request;
        const approveTx: ViemPlanWriteRequest = {
          ...approveRequest,
          ...gasOverrides,
          ...(approveGas
            ? {
                gas: approveGas.gasLimit,
                maxFeePerGas: approveGas.maxFeePerGas,
                maxPriorityFeePerGas: approveGas.maxPriorityFeePerGas,
              }
            : {}),
        };

        steps.push({
          key: `approve:l2:${p.token}:${ctx.l2NativeTokenVault}`,
          kind: 'approve:l2',
          description: `Approve ${p.amount} to NativeTokenVault`,
          tx: approveTx,
        });
      }

      // ---------------------------------------------------------------------
      // 3) Ensure token is registered in L2NativeTokenVault (static/sim call)
      // ---------------------------------------------------------------------
      const ensure = await wrapAs(
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
      );

      const assetId = ensure.result;

      const assetData = encodeAbiParameters(
        [
          { type: 'uint256', name: 'amount' },
          { type: 'address', name: 'l1Receiver' },
          { type: 'address', name: 'l2Token' },
        ],
        [p.amount, toL1, p.token],
      );

      // ---------------------------------------------------------------------
      // 4) Withdraw step (L2AssetRouter.withdraw(assetId, assetData))
      //    - Always quote gas from calldata.
      //    - Simulate only if approvals are not required.
      // ---------------------------------------------------------------------
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
        ...gasOverrides,
      };

      const withdrawGas = await quoteL2Gas({ ctx, tx: withdrawTxCandidate });

      let withdrawTx: ViemPlanWriteRequest;

      if (needsApprove) {
        // Do NOT simulate (can revert prior to approve). Return raw write params.
        withdrawTx = {
          address: ctx.l2AssetRouter,
          abi: IL2AssetRouterABI,
          functionName: 'withdraw',
          args: [assetId, assetData] as const,
          account: ctx.client.account,
          ...gasOverrides,
          ...(withdrawGas
            ? {
                gas: withdrawGas.gasLimit,
                maxFeePerGas: withdrawGas.maxFeePerGas,
                maxPriorityFeePerGas: withdrawGas.maxPriorityFeePerGas,
              }
            : {}),
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
              ...gasOverrides,
            }),
          {
            ctx: { where: 'l2.simulateContract', to: ctx.l2AssetRouter },
            message: 'Failed to simulate L2 ERC-20 withdraw.',
          },
        );

        const { ...withdrawRequest } = sim.request;
        withdrawTx = {
          ...withdrawRequest,
          ...gasOverrides,
          ...(withdrawGas
            ? {
                gas: withdrawGas.gasLimit,
                maxFeePerGas: withdrawGas.maxFeePerGas,
                maxPriorityFeePerGas: withdrawGas.maxPriorityFeePerGas,
              }
            : {}),
        };
      }

      steps.push({
        key: 'l2-asset-router:withdraw',
        kind: 'l2-asset-router:withdraw',
        description: 'Burn on L2 & send L2→L1 message',
        tx: withdrawTx,
      });

      // ---------------------------------------------------------------------
      // 5) Fees (single L2 tx cost)
      //     - We mirror ethers behavior: feeToken = base token on L2
      //     - l2Gas = withdrawGas (approve not included, same as ethers route)
      // ---------------------------------------------------------------------
      const feeToken = await ctx.client.baseToken(ctx.chainIdL2);
      const fees = buildFeeBreakdown({
        feeToken,
        l2Gas: withdrawGas,
      });

      return { steps, approvals, fees };
    },
  };
}
