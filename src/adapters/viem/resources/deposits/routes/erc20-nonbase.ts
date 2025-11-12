// src/adapters/viem/resources/deposits/routes/erc20-nonbase.ts
import type { DepositRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';
import { encodeSecondBridgeErc20Args, buildViemFeeOverrides } from '../../utils';
import { IERC20ABI, IBridgehubABI } from '../../../../../core/internal/abi-registry.ts';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { isETH, normalizeAddrEq } from '../../../../../core/utils/addr';
import type { Abi } from 'viem';

const { wrapAs } = createErrorHandlers('deposits');

const BASE_COST_BUFFER_BPS = 100n; // 1%
const BPS = 10_000n;
const withBuffer = (x: bigint) => (x * (BPS + BASE_COST_BUFFER_BPS)) / BPS;

export function routeErc20NonBase(): DepositRouteStrategy {
  return {
    async preflight(p, ctx) {
      // Validations: deposit token must be ERC-20 and not the base token
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

      const baseToken = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.nonbase.baseToken,
        () =>
          ctx.client.l1.readContract({
            address: ctx.bridgehub,
            abi: IBridgehubABI as Abi,
            functionName: 'baseToken',
            args: [ctx.chainIdL2],
          }),
        { ctx: { where: 'bridgehub.baseToken', chainIdL2: ctx.chainIdL2 } },
      )) as `0x${string}`;

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

      return;
    },

    async build(p, ctx) {
      const { gasPriceForBaseCost } = ctx.fee;
      const txFeeOverrides = buildViemFeeOverrides(ctx.fee);

      // Read base token
      const baseToken = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.nonbase.baseToken,
        () =>
          ctx.client.l1.readContract({
            address: ctx.bridgehub,
            abi: IBridgehubABI as Abi,
            functionName: 'baseToken',
            args: [ctx.chainIdL2],
          }),
        { ctx: { where: 'bridgehub.baseToken', chainIdL2: ctx.chainIdL2 } },
      )) as `0x${string}`;

      // TODO: again need to consolidate all gas estimations, buffers, etc.
      const MIN_L2_GAS_FOR_ERC20 = 2_500_000n;
      const l2GasLimitUsed =
        ctx.l2GasLimit && ctx.l2GasLimit > 0n
          ? ctx.l2GasLimit < MIN_L2_GAS_FOR_ERC20
            ? MIN_L2_GAS_FOR_ERC20
            : ctx.l2GasLimit
          : MIN_L2_GAS_FOR_ERC20;

      // Base cost (L2 fee) → mintValue = baseCost + tip (buffered)
      const rawBaseCost = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.nonbase.baseCost,
        () =>
          ctx.client.l1.readContract({
            address: ctx.bridgehub,
            abi: IBridgehubABI as Abi,
            functionName: 'l2TransactionBaseCost',
            args: [ctx.chainIdL2, gasPriceForBaseCost, l2GasLimitUsed, ctx.gasPerPubdata],
          }),
        { ctx: { where: 'l2TransactionBaseCost', chainIdL2: ctx.chainIdL2 } },
      )) as bigint;

      const baseCost = rawBaseCost;
      const mintValue = withBuffer(baseCost + ctx.operatorTip);

      // Approvals
      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<ViemPlanWriteRequest>[] = [];

      const depositAllowance = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.nonbase.allowance,
        () =>
          ctx.client.l1.readContract({
            address: p.token,
            abi: IERC20ABI as Abi,
            functionName: 'allowance',
            args: [ctx.sender, ctx.l1AssetRouter],
          }),
        {
          ctx: { where: 'erc20.allowance', token: p.token, spender: ctx.l1AssetRouter },
          message: 'Failed to read ERC-20 allowance for deposit token.',
        },
      )) as bigint;

      const needsDepositApprove = depositAllowance < p.amount;
      if (needsDepositApprove) {
        const approveDepReq = await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.nonbase.estGas,
          () =>
            ctx.client.l1.simulateContract({
              address: p.token,
              abi: IERC20ABI,
              functionName: 'approve',
              args: [ctx.l1AssetRouter, p.amount] as const,
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'l1.simulateContract', to: p.token },
            message: 'Failed to simulate deposit token approve.',
          },
        );

        approvals.push({ token: p.token, spender: ctx.l1AssetRouter, amount: p.amount });
        steps.push({
          key: `approve:${p.token}:${ctx.l1AssetRouter}`,
          kind: 'approve',
          description: `Approve deposit token for amount`,
          tx: { ...approveDepReq.request, ...txFeeOverrides },
        });
      }

      const baseIsEth = isETH(baseToken);
      let msgValue: bigint = 0n;

      if (!baseIsEth) {
        const baseAllowance = (await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.nonbase.allowanceFees,
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

        if (baseAllowance < mintValue) {
          const approveBaseReq = await wrapAs(
            'CONTRACT',
            OP_DEPOSITS.nonbase.estGas,
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
            description: `Approve base token for mintValue`,
            tx: { ...approveBaseReq.request, ...txFeeOverrides },
          });
        }

        // Base is ERC-20 ⇒ msg.value MUST be 0
        msgValue = 0n;
      } else {
        // Base is ETH ⇒ fees in ETH (msg.value = mintValue)
        msgValue = mintValue;
      }

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
        },
      );

      const outer = {
        chainId: ctx.chainIdL2,
        mintValue,
        l2Value: 0n,
        l2GasLimit: l2GasLimitUsed,
        l2GasPerPubdataByteLimit: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        secondBridgeAddress: ctx.l1AssetRouter,
        secondBridgeValue: 0n,
        secondBridgeCalldata,
      } as const;

      // viem simulate/write:
      // If any approval is required, skip simulate (can revert) and return a raw write.
      const approvalsNeeded = approvals.length > 0;
      let bridgeTx: ViemPlanWriteRequest;
      let resolvedL1GasLimit: bigint | undefined;
      const gasOverride = txFeeOverrides.gas as bigint | undefined;

      if (approvalsNeeded) {
        bridgeTx = {
          address: ctx.bridgehub,
          abi: IBridgehubABI,
          functionName: 'requestL2TransactionTwoBridges',
          args: [outer],
          value: msgValue,
          account: ctx.client.account,
          ...txFeeOverrides,
        } as const;
        resolvedL1GasLimit = gasOverride ?? ctx.l2GasLimit;
      } else {
        const sim = await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.nonbase.estGas,
          () =>
            ctx.client.l1.simulateContract({
              address: ctx.bridgehub,
              abi: IBridgehubABI,
              functionName: 'requestL2TransactionTwoBridges',
              args: [outer],
              value: msgValue,
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'l1.simulateContract', to: ctx.bridgehub },
            message: 'Failed to simulate two-bridges request.',
          },
        );
        bridgeTx = { ...sim.request, ...txFeeOverrides };
        resolvedL1GasLimit = sim.request.gas ?? ctx.l2GasLimit;
      }

      steps.push({
        key: 'bridgehub:two-bridges:nonbase',
        kind: 'bridgehub:two-bridges',
        description: baseIsEth
          ? 'Bridge ERC-20 (fees in ETH) via Bridgehub.requestL2TransactionTwoBridges'
          : 'Bridge ERC-20 (fees in base ERC-20) via Bridgehub.requestL2TransactionTwoBridges',
        tx: bridgeTx,
      });

      return {
        steps,
        approvals,
        quoteExtras: { baseCost, mintValue, l1GasLimit: resolvedL1GasLimit },
      };
    },
  };
}
