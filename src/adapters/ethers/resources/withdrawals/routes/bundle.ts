import { Contract, Interface, type TransactionRequest } from 'ethers';
import type { ApprovalNeed, PlanStep } from '../../../../../core/types/flows/base';
import type { WithdrawParams } from '../../../../../core/types/flows/withdrawals';
import type { Hex } from '../../../../../core/types/primitives';
import { FORMAL_ETH_ADDRESS, L2_BASE_TOKEN_ADDRESS } from '../../../../../core/constants';
import { IERC20ABI, IInteropCenterABI } from '../../../../../core/abi';
import { buildWithdrawalBundle } from '../../../../../core/internal/cross-chain/withdrawal-bundle';
import {
  generateBundleSalt,
  type RandomBytes,
} from '../../../../../core/internal/cross-chain/salt';
import { interopCodec } from '../../interop/address';
import { createEthersAttributesResource } from '../../interop/attributes/resource';
import { encodeNativeTokenVaultTransferData, encodeSecondBridgeDataV1 } from '../../utils';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_WITHDRAWALS } from '../../../../../core/types/errors';
import type { BuildCtx } from '../context';
import { quoteL2Gas } from '../services/gas';
import { buildFeeBreakdown } from '../services/fees';
import type { WithdrawRouteStrategy } from './types';

const { wrapAs } = createErrorHandlers('withdrawals');

export interface WithdrawalBundleRouteOptions {
  randomBytes?: RandomBytes;
}

async function resolveBundleTarget(ctx: BuildCtx) {
  const [{ chainId: l1ChainId }, { interopCenter }] = await Promise.all([
    ctx.client.l1.getNetwork(),
    ctx.client.ensureAddresses(),
  ]);
  return { l1ChainId: BigInt(l1ChainId), interopCenter };
}

function buildBundle(
  input: {
    kind: 'base' | 'erc20';
    params: WithdrawParams;
    ctx: BuildCtx;
    assetId: Hex;
    transferToken: `0x${string}`;
    l1ChainId: bigint;
  },
  opts: WithdrawalBundleRouteOptions,
) {
  const transferData = encodeNativeTokenVaultTransferData(
    input.params.amount,
    input.params.to ?? input.ctx.sender,
    input.transferToken,
  ) as Hex;
  const assetRouterPayload = encodeSecondBridgeDataV1(input.assetId, transferData) as Hex;

  return buildWithdrawalBundle({
    kind: input.kind,
    amount: input.params.amount,
    l1ChainId: input.l1ChainId,
    l2AssetRouter: input.ctx.l2AssetRouter,
    assetRouterPayload,
    salt: generateBundleSalt(opts.randomBytes),
    codec: interopCodec,
    attributes: createEthersAttributesResource(),
  });
}

export function routeEthBaseBundle(opts: WithdrawalBundleRouteOptions = {}): WithdrawRouteStrategy {
  return {
    async build(params, ctx) {
      const { l1ChainId, interopCenter } = await resolveBundleTarget(ctx);
      const bundle = buildBundle(
        {
          kind: 'base',
          params,
          ctx,
          assetId: ctx.baseTokenAssetId,
          transferToken: FORMAL_ETH_ADDRESS,
          l1ChainId,
        },
        opts,
      );
      const data = new Interface(IInteropCenterABI).encodeFunctionData('sendBundle', [
        bundle.dstChain,
        bundle.starters,
        bundle.bundleAttributes,
      ]) as Hex;
      const tx: TransactionRequest = {
        to: interopCenter,
        from: ctx.sender,
        data,
        value: bundle.transactionValue,
      };
      const gas = await quoteL2Gas({ ctx, tx });
      if (gas) {
        tx.gasLimit = gas.gasLimit;
        tx.maxFeePerGas = gas.maxFeePerGas;
        tx.maxPriorityFeePerGas = gas.maxPriorityFeePerGas;
      }

      return {
        steps: [
          {
            key: 'l2-base-token:withdraw',
            kind: 'l2-base-token:withdraw',
            description: 'Withdraw base token through an L1 interop bundle',
            tx,
          },
        ],
        approvals: [],
        fees: buildFeeBreakdown({ feeToken: L2_BASE_TOKEN_ADDRESS, l2Gas: gas }),
      };
    },
  };
}

export function routeErc20NonBaseBundle(
  opts: WithdrawalBundleRouteOptions = {},
): WithdrawRouteStrategy {
  return {
    async build(params, ctx) {
      const steps: Array<PlanStep<TransactionRequest>> = [];
      const approvals: ApprovalNeed[] = [];
      const erc20 = new Contract(params.token, IERC20ABI, ctx.client.getL2Signer());
      const current = (await wrapAs(
        'CONTRACT',
        OP_WITHDRAWALS.erc20.allowance,
        () => erc20.allowance(ctx.sender, ctx.l2NativeTokenVault),
        {
          ctx: {
            where: 'erc20.allowance',
            chain: 'L2',
            token: params.token,
            spender: ctx.l2NativeTokenVault,
          },
          message: 'Failed to read L2 ERC-20 allowance.',
        },
      )) as bigint;

      if (current < params.amount) {
        approvals.push({
          token: params.token,
          spender: ctx.l2NativeTokenVault,
          amount: params.amount,
        });
        const approveTx: TransactionRequest = {
          to: params.token,
          from: ctx.sender,
          data: erc20.interface.encodeFunctionData('approve', [
            ctx.l2NativeTokenVault,
            params.amount,
          ]),
        };
        const approveGas = await quoteL2Gas({ ctx, tx: approveTx });
        if (approveGas) {
          approveTx.gasLimit = approveGas.gasLimit;
          approveTx.maxFeePerGas = approveGas.maxFeePerGas;
          approveTx.maxPriorityFeePerGas = approveGas.maxPriorityFeePerGas;
        }
        steps.push({
          key: `approve:l2:${params.token}:${ctx.l2NativeTokenVault}`,
          kind: 'approve:l2',
          description: `Approve ${params.amount} to NativeTokenVault`,
          tx: approveTx,
        });
      }

      const assetId = await wrapAs(
        'CONTRACT',
        OP_WITHDRAWALS.erc20.ensureRegistered,
        async () => {
          const ntv = await ctx.contracts.l2NativeTokenVault();
          return (await ntv.getFunction('ensureTokenIsRegistered').staticCall(params.token)) as Hex;
        },
        {
          ctx: { where: 'L2NativeTokenVault.ensureTokenIsRegistered', token: params.token },
          message: 'Failed to ensure token is registered in L2NativeTokenVault.',
        },
      );
      const { l1ChainId, interopCenter } = await resolveBundleTarget(ctx);
      const bundle = buildBundle(
        {
          kind: 'erc20',
          params,
          ctx,
          assetId,
          transferToken: params.token,
          l1ChainId,
        },
        opts,
      );
      const data = new Interface(IInteropCenterABI).encodeFunctionData('sendBundle', [
        bundle.dstChain,
        bundle.starters,
        bundle.bundleAttributes,
      ]) as Hex;
      const tx: TransactionRequest = {
        to: interopCenter,
        from: ctx.sender,
        data,
        value: 0n,
      };
      const gas = current >= params.amount ? await quoteL2Gas({ ctx, tx }) : undefined;
      if (gas) {
        tx.gasLimit = gas.gasLimit;
        tx.maxFeePerGas = gas.maxFeePerGas;
        tx.maxPriorityFeePerGas = gas.maxPriorityFeePerGas;
      }
      steps.push({
        key: 'l2-asset-router:withdraw',
        kind: 'l2-asset-router:withdraw',
        description: 'Burn on L2 and send an L1 interop bundle',
        tx,
      });

      return {
        steps,
        approvals,
        fees: buildFeeBreakdown({
          feeToken: ctx.baseTokenL1 ?? (await ctx.client.baseToken(ctx.chainIdL2)),
          l2Gas: gas,
        }),
      };
    },
  };
}
