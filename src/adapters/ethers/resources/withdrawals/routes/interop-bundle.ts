// src/adapters/ethers/resources/withdrawals/routes/interop-bundle.ts
//
// Protocol v32+ withdrawal route: one InteropCenter bundle, destined for L1.
//
// This single strategy covers both the base-token and the ERC-20 case, because v32 unified them:
// `L2BaseToken.withdraw` and `L2AssetRouter.withdraw` were both removed, and everything now goes
// through `InteropCenter.sendBundle` with a single indirect call to the L2 AssetRouter.

import { AbiCoder, Contract, keccak256, type TransactionRequest } from 'ethers';
import type { WithdrawRouteStrategy } from './types';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';
import type { Address, Hex } from '../../../../../core/types/primitives';
import { IERC20ABI } from '../../../../../core/abi';
import { FORMAL_ETH_ADDRESS } from '../../../../../core/constants';

import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_WITHDRAWALS } from '../../../../../core/types';
import { quoteL2Gas } from '../services/gas';
import { buildFeeBreakdown } from '../services/fees';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';
import { interopCodec } from '../../interop/address';
import { createEthersAttributesResource } from '../../interop/attributes/resource';
import { buildWithdrawalBundle } from '../../../../../core/resources/withdrawals/bundle';

const { wrapAs } = createErrorHandlers('withdrawals');

const attributes = createEthersAttributesResource();

/** `keccak256(abi.encode(address,uint256))`, matching the harness' salt derivation. */
function saltFor(sender: Address, nonce: number): Hex {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [sender, BigInt(nonce)]),
  ) as Hex;
}

export function routeInteropBundle(): WithdrawRouteStrategy {
  return {
    async build(p, ctx) {
      const steps: Array<PlanStep<TransactionRequest>> = [];
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
        assetId = await wrapAs(
          'CONTRACT',
          OP_WITHDRAWALS.erc20.ensureRegistered,
          async () => {
            const ntv = await ctx.contracts.l2NativeTokenVault();
            return (await ntv
              .getFunction('ensureTokenIsRegistered')
              .staticCall(p.token)) as `0x${string}`;
          },
          {
            ctx: { where: 'L2NativeTokenVault.ensureTokenIsRegistered', token: p.token },
            message: 'Failed to ensure token is registered in L2NativeTokenVault.',
          },
        );

        // The vault pulls the ERC-20 from the sender during the indirect call, so it needs an
        // allowance. Read through the L2 provider, not the signer: a browser wallet may refuse.
        const erc20 = new Contract(p.token, IERC20ABI, ctx.client.l2);
        const current = (await wrapAs(
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

        allowanceSufficient = current >= p.amount;

        if (!allowanceSufficient) {
          approvals.push({ token: p.token, spender: ctx.l2NativeTokenVault, amount: p.amount });

          const approveTx: TransactionRequest = {
            to: p.token,
            data: erc20.interface.encodeFunctionData('approve', [ctx.l2NativeTokenVault, p.amount]),
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
      }

      // ---------------------------------------------------------------------
      // Bundle
      // ---------------------------------------------------------------------
      // The salt must be fresh per (sender, salt) pair. Deriving it from the pending L2 nonce keeps
      // it deterministic for a given transaction while guaranteeing it advances.
      const nonce = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.prepare,
        () => ctx.client.l2.getTransactionCount(ctx.sender, 'pending'),
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
          encodeBridgeBurnData: (amount, receiver, token) =>
            encodeNativeTokenVaultTransferData(amount, receiver, token) as Hex,
          encodeAssetRouterDepositData: (id, data) => encodeSecondBridgeDataV1(id, data) as Hex,
        },
      });

      const interopCenter = await ctx.contracts.interopCenter();
      const data = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.erc20.encodeWithdraw,
        () =>
          Promise.resolve(
            interopCenter.interface.encodeFunctionData('sendBundle', [
              bundle.destinationChain,
              bundle.starters,
              bundle.bundleAttributes,
            ]) as Hex,
          ),
        {
          ctx: { where: 'InteropCenter.sendBundle', assetId },
          message: 'Failed to encode sendBundle calldata.',
        },
      );

      const sendTx: TransactionRequest = {
        to: ctx.interopCenter,
        data,
        from: ctx.sender,
        value: bundle.value,
      };

      // Estimating before the approval lands would revert on the vault's transferFrom, so skip it
      // in that case and let `create` fall back to its own estimate after the approval is mined.
      const sendGas = allowanceSufficient ? await quoteL2Gas({ ctx, tx: sendTx }) : undefined;
      if (sendGas) {
        sendTx.gasLimit = sendGas.gasLimit;
        sendTx.maxFeePerGas = sendGas.maxFeePerGas;
        sendTx.maxPriorityFeePerGas = sendGas.maxPriorityFeePerGas;
      }

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
