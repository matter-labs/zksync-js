// src/adapters/ethers/resources/withdrawals/routes/erc20-nonbase.ts

import { AbiCoder, Contract, type TransactionRequest } from 'ethers';
import type { WithdrawRouteStrategy } from './types';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';
import { IL2AssetRouterABI, L2NativeTokenVaultABI, IERC20ABI } from '../../../../../core/abi';

import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_WITHDRAWALS } from '../../../../../core/types';

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
      const { gasLimit: overrideGasLimit, maxFeePerGas, maxPriorityFeePerGas } = ctx.fee;
      const txOverrides =
        overrideGasLimit != null
          ? { maxFeePerGas, maxPriorityFeePerGas, gasLimit: overrideGasLimit }
          : { maxFeePerGas, maxPriorityFeePerGas };

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

        steps.push({
          key: `approve:l2:${p.token}:${ctx.l2NativeTokenVault}`,
          kind: 'approve:l2',
          description: `Approve ${p.amount} to NativeTokenVault`,
          tx: { to: p.token, data, from: ctx.sender, ...txOverrides },
        });
      }

      // Compute assetId + assetData
      const ntv = new Contract(ctx.l2NativeTokenVault, L2NativeTokenVaultABI, ctx.client.l2);
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
            AbiCoder.defaultAbiCoder().encode(
              ['uint256', 'address', 'address'],
              [p.amount, p.to ?? ctx.sender, p.token],
            ),
          ),
        {
          ctx: { where: 'AbiCoder.encode', token: p.token, to: p.to ?? ctx.sender },
          message: 'Failed to encode burn/withdraw asset data.',
        },
      );

      // L2AssetRouter.withdraw(assetId, assetData)
      const l2ar = new Contract(ctx.l2AssetRouter, IL2AssetRouterABI, ctx.client.l2);
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
        ...txOverrides,
      };

      steps.push({
        key: 'l2-asset-router:withdraw',
        kind: 'l2-asset-router:withdraw',
        description: 'Burn on L2 & send L2→L1 message',
        tx: withdrawTx,
      });

      return { steps, approvals, quoteExtras: {} };
    },
  };
}
