// src/adapters/viem/resources/withdrawals/routes/interop-bundle.ts
//
// Protocol v32+ withdrawal route: one InteropCenter bundle, destined for L1.
//
// This single strategy covers both the base-token and the ERC-20 case, because v32 unified them:
// `L2BaseToken.withdraw` and `L2AssetRouter.withdraw` were both removed, and everything now goes
// through `InteropCenter.sendBundle` with a single indirect call to the L2 AssetRouter.

import type { WithdrawRouteStrategy, ViemPlanWriteRequest } from './types.ts';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base.ts';
import type { Address, Hex } from '../../../../../core/types/primitives';

import { IERC20ABI, L2NativeTokenVaultABI, IInteropCenterABI } from '../../../../../core/abi.ts';
import { FORMAL_ETH_ADDRESS } from '../../../../../core/constants';

import type { Abi, TransactionRequest } from 'viem';
import { encodeAbiParameters, encodeFunctionData, keccak256 } from 'viem';

import { createErrorHandlers } from '../../../errors/error-ops.ts';
import { OP_WITHDRAWALS } from '../../../../../core/types/index.ts';

import { quoteL2Gas } from '../services/gas.ts';
import { buildFeeBreakdown } from '../services/fee.ts';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';
import { interopCodec } from '../../interop/address';
import { createViemAttributesResource } from '../../interop/attributes/resource';
import { buildWithdrawalBundle } from '../../../../../core/resources/withdrawals/bundle';

const { wrapAs } = createErrorHandlers('withdrawals');

const attributes = createViemAttributesResource();

/** `keccak256(abi.encode(address,uint256))`, matching the harness' salt derivation. */
function saltFor(sender: Address, nonce: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address', name: 'sender' },
        { type: 'uint256', name: 'nonce' },
      ],
      [sender, BigInt(nonce)],
    ),
  );
}

export function routeInteropBundle(): WithdrawRouteStrategy {
  return {
    async build(p, ctx) {
      const steps: Array<PlanStep<ViemPlanWriteRequest>> = [];
      const approvals: ApprovalNeed[] = [];

      const isBaseToken = ctx.route === 'base';
      const l1Receiver = p.to ?? ctx.sender;

      // ---------------------------------------------------------------------
      // Asset id + NTV approval
      // ---------------------------------------------------------------------
      let assetId: Hex;
      let allowanceSufficient = true;

      if (isBaseToken) {
        // The base-token asset id is already resolved on the context; the burn leaves the token
        // address zero so the vault derives it from the asset id.
        assetId = ctx.baseTokenAssetId;
      } else {
        assetId = (
          await wrapAs(
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
          )
        ).result;

        // The vault pulls the ERC-20 from the sender during the indirect call, so it needs an
        // allowance.
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

        allowanceSufficient = current >= p.amount;

        if (!allowanceSufficient) {
          approvals.push({ token: p.token, spender: ctx.l2NativeTokenVault, amount: p.amount });

          const approveTxCandidate: TransactionRequest = {
            to: p.token,
            data: encodeFunctionData({
              abi: IERC20ABI as Abi,
              functionName: 'approve',
              args: [ctx.l2NativeTokenVault, p.amount] as const,
            }),
            value: 0n,
            from: ctx.sender,
          };

          const approveGas = await quoteL2Gas({ ctx, tx: approveTxCandidate });

          steps.push({
            key: `approve:l2:${p.token}:${ctx.l2NativeTokenVault}`,
            kind: 'approve:l2',
            description: `Approve ${p.amount} to NativeTokenVault`,
            tx: {
              address: p.token,
              abi: IERC20ABI,
              functionName: 'approve',
              args: [ctx.l2NativeTokenVault, p.amount] as const,
              account: ctx.client.account,
              ...approveGas,
            } satisfies ViemPlanWriteRequest,
          });
        }
      }

      // ---------------------------------------------------------------------
      // Bundle
      // ---------------------------------------------------------------------
      // The salt must be fresh per (sender, salt) pair. Deriving it from the pending L2 nonce keeps
      // it deterministic for a given transaction while guaranteeing it advances.
      const nonce = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.prepare,
        () => ctx.client.l2.getTransactionCount({ address: ctx.sender, blockTag: 'pending' }),
        {
          ctx: { where: 'l2.getTransactionCount', sender: ctx.sender },
          message: 'Failed to read L2 nonce for the interop bundle salt.',
        },
      );

      const bundle = buildWithdrawalBundle({
        assetId,
        amount: p.amount,
        l1Receiver,
        l2Token: isBaseToken ? FORMAL_ETH_ADDRESS : p.token,
        isBaseToken,
        l1ChainId: ctx.l1ChainId,
        l2AssetRouter: ctx.l2AssetRouter,
        salt: saltFor(ctx.sender, nonce),
        codec: interopCodec,
        attributes: {
          indirectCall: attributes.call.indirectCall,
          interopCallValue: attributes.call.interopCallValue,
          interopBundleSalt: attributes.bundle.interopBundleSalt,
        },
        transferData: {
          encodeBridgeBurnData: encodeNativeTokenVaultTransferData,
          encodeAssetRouterDepositData: encodeSecondBridgeDataV1,
        },
      });

      const sendArgs = [bundle.destinationChain, bundle.starters, bundle.bundleAttributes] as const;

      const sendTxCandidate: TransactionRequest = {
        to: ctx.interopCenter,
        data: encodeFunctionData({
          abi: IInteropCenterABI as Abi,
          functionName: 'sendBundle',
          args: sendArgs,
        }),
        value: bundle.value,
        from: ctx.sender,
      };

      // Estimating before the approval lands would revert on the vault's transferFrom, so skip it
      // in that case and let `create` fall back to its own estimate after the approval is mined.
      const sendGas = allowanceSufficient
        ? await quoteL2Gas({ ctx, tx: sendTxCandidate })
        : undefined;

      const sendTx: ViemPlanWriteRequest = {
        address: ctx.interopCenter,
        abi: IInteropCenterABI,
        functionName: 'sendBundle',
        args: sendArgs,
        account: ctx.client.account,
        value: bundle.value,
        ...sendGas,
      } as ViemPlanWriteRequest;

      steps.push({
        key: 'interop-center:send-bundle',
        kind: 'interop-center:send-bundle',
        description: 'Burn on L2 & send L2→L1 withdrawal bundle',
        tx: sendTx,
      });

      const fees = buildFeeBreakdown({
        feeToken: ctx.baseTokenL1 ?? (await ctx.client.baseToken(ctx.chainIdL2)),
        l2Gas: sendGas,
      });

      return { steps, approvals, fees };
    },
  };
}
