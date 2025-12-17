// src/adapters/ethers/resources/withdrawals/routes/erc20-nonbase.ts

import { Contract, type TransactionRequest } from 'ethers';
import type { WithdrawRouteStrategy } from './types';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';
import { IERC20ABI } from '../../../../../core/abi';

import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_WITHDRAWALS } from '../../../../../core/types';
import { quoteL2Gas } from '../services/gas';
import { buildFeeBreakdown } from '../services/fees';
import { encodeNativeTokenVaultTransferData } from '../../utils';

const { wrapAs } = createErrorHandlers('withdrawals');

// Strongly-typed signatures for overloaded functions
// Necessary for ethers v6 when contract has multiple functions with same name
// which is the case for L2AssetRouter.withdraw
const SIG = {
  withdraw: 'withdraw(bytes32,bytes)',
} as const;

// Route for withdrawing ERC-20 via L2-L1
export function routeErc20NonBase(): WithdrawRouteStrategy {
  return {
    async build(p, ctx) {
      const steps: Array<PlanStep<TransactionRequest>> = [];
      const approvals: ApprovalNeed[] = [];

      // L2 allowance
      const erc20 = new Contract(p.token, IERC20ABI, ctx.client.getL2Signer());
      const current: bigint = (await wrapAs(
        'CONTRACT',
        OP_WITHDRAWALS.erc20.allowance,
        () => erc20.allowance(ctx.sender, ctx.l2NativeTokenVault),
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

        const data = erc20.interface.encodeFunctionData('approve', [
          ctx.l2NativeTokenVault,
          p.amount,
        ]);

        const approveTx: TransactionRequest = {
          to: p.token,
          data: data,
          from: ctx.sender,
        };

        const approveGas = await quoteL2Gas({ ctx, tx: approveTx });
        if (approveGas) {
          approveTx.gasLimit = approveGas.gasLimit;
          approveTx.maxFeePerGas = approveGas.maxFeePerGas;
          approveTx.maxPriorityFeePerGas = approveGas.maxPriorityFeePerGas;
        }

        steps.push({
          key: `approve:l2:${p.token}:${ctx.l2NativeTokenVault}`,
          kind: 'approve:l2',
          description: `Approve ${p.amount} to NativeTokenVault`,
          tx: approveTx,
        });
      }

      // Compute assetId + assetData
      const ntv = (await ctx.client.contracts()).l2NativeTokenVault;
      const assetId = (await wrapAs(
        'CONTRACT',
        OP_WITHDRAWALS.erc20.ensureRegistered,
        () => ntv.getFunction('ensureTokenIsRegistered').staticCall(p.token),
        {
          ctx: { where: 'L2NativeTokenVault.ensureTokenIsRegistered', token: p.token },
          message: 'Failed to ensure token is registered in L2NativeTokenVault.',
        },
      )) as `0x${string}`;
      const assetData = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.erc20.encodeAssetData,
        () =>
          Promise.resolve(
            encodeNativeTokenVaultTransferData(p.amount, p.to ?? ctx.sender, p.token),
          ),
        {
          ctx: { where: 'AbiCoder.encode', token: p.token, to: p.to ?? ctx.sender },
          message: 'Failed to encode burn/withdraw asset data.',
        },
      );

      // L2AssetRouter.withdraw(assetId, assetData)
      const l2ar = (await ctx.client.contracts()).l2AssetRouter;
      const dataWithdraw = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.erc20.encodeWithdraw,
        () =>
          Promise.resolve(l2ar.interface.encodeFunctionData(SIG.withdraw, [assetId, assetData])),
        {
          ctx: { where: 'L2AssetRouter.withdraw', assetId },
          message: 'Failed to encode withdraw calldata.',
        },
      );

      const withdrawTx: TransactionRequest = {
        to: ctx.l2AssetRouter,
        data: dataWithdraw,
        from: ctx.sender,
      };

      const withdrawGas = await quoteL2Gas({ ctx, tx: withdrawTx });
      if (withdrawGas) {
        withdrawTx.gasLimit = withdrawGas.gasLimit;
        withdrawTx.maxFeePerGas = withdrawGas.maxFeePerGas;
        withdrawTx.maxPriorityFeePerGas = withdrawGas.maxPriorityFeePerGas;
      }

      steps.push({
        key: 'l2-asset-router:withdraw',
        kind: 'l2-asset-router:withdraw',
        description: 'Burn on L2 & send L2→L1 message',
        tx: withdrawTx,
      });

      const fees = buildFeeBreakdown({
        feeToken: await ctx.client.baseToken(ctx.chainIdL2),
        l2Gas: withdrawGas,
      });

      return { steps, approvals, fees };
    },
  };
}
