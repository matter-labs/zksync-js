// src/adapters/viem/resources/deposits/routes/erc20-base.ts

import type { DepositRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';
import { IBridgehubABI, IERC20ABI } from '../../../../../core/internal/abi-registry.ts';
import { buildDirectRequestStruct, buildViemFeeOverrides } from '../../utils';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { normalizeAddrEq, isETH } from '../../../../../core/utils/addr';
import type { Abi } from 'viem';

const { wrapAs } = createErrorHandlers('deposits');

// TODO: all gas buffers need to be moved to a dedicated resource
// this is getting messy
const BASE_COST_BUFFER_BPS = 100n; // 1%
const BPS = 10_000n;
const withBuffer = (x: bigint) => (x * (BPS + BASE_COST_BUFFER_BPS)) / BPS;

//  ERC20 deposit where the deposit token IS the target chain's base token (base ≠ ETH).
export function routeErc20Base(): DepositRouteStrategy {
  return {
    async preflight(p, ctx) {
      // Must be ERC-20 (not ETH)
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.base.assertErc20Asset,
        () => {
          if (isETH(p.token)) {
            throw new Error('erc20-base route requires an ERC-20 token (not ETH).');
          }
        },
        { ctx: { token: p.token } },
      );

      // Check provided token matches target chain base token
      const baseToken = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.base.baseToken,
        () =>
          ctx.client.l1.readContract({
            address: ctx.bridgehub,
            abi: IBridgehubABI as Abi,
            functionName: 'baseToken',
            args: [ctx.chainIdL2],
          }),
        {
          ctx: { where: 'bridgehub.baseToken', chainIdL2: ctx.chainIdL2 },
          message: 'Failed to read base token.',
        },
      )) as `0x${string}`;

      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.base.assertMatchesBase,
        () => {
          if (!normalizeAddrEq(baseToken, p.token)) {
            throw new Error('Provided token is not the base token for the target chain.');
          }
        },
        { ctx: { baseToken, provided: p.token, chainIdL2: ctx.chainIdL2 } },
      );

      return;
    },

    async build(p, ctx) {
      const { gasPriceForBaseCost } = ctx.fee;
      const txFeeOverrides = buildViemFeeOverrides(ctx.fee);
      const gasOverride = txFeeOverrides.gas as bigint | undefined;

      const baseToken = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.base.baseToken,
        () =>
          ctx.client.l1.readContract({
            address: ctx.bridgehub,
            abi: IBridgehubABI as Abi,
            functionName: 'baseToken',
            args: [ctx.chainIdL2],
          }),
        {
          ctx: { where: 'bridgehub.baseToken', chainIdL2: ctx.chainIdL2 },
          message: 'Failed to read base token.',
        },
      )) as `0x${string}`;

      // Base cost on L2
      const rawBaseCost = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.base.baseCost,
        () =>
          ctx.client.l1.readContract({
            address: ctx.bridgehub,
            abi: IBridgehubABI as Abi,
            functionName: 'l2TransactionBaseCost',
            args: [ctx.chainIdL2, gasPriceForBaseCost, ctx.l2GasLimit, ctx.gasPerPubdata],
          }),
        {
          ctx: { where: 'l2TransactionBaseCost', chainIdL2: ctx.chainIdL2 },
          message: 'Could not fetch L2 base cost from Bridgehub.',
        },
      )) as bigint;

      const baseCost = rawBaseCost;
      const l2Value = p.amount;
      // Direct path: mintValue must cover fee + the L2 msg.value (amount) → plus a small buffer
      const rawMintValue = baseCost + ctx.operatorTip + l2Value;
      const mintValue = withBuffer(rawMintValue);

      // Check allowance for base token -> L1AssetRouter
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

      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<ViemPlanWriteRequest>[] = [];

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
          tx: { ...approveSim.request, ...txFeeOverrides },
        });
      }

      const req = buildDirectRequestStruct({
        chainId: ctx.chainIdL2,
        mintValue,
        l2GasLimit: ctx.l2GasLimit,
        gasPerPubdata: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        l2Contract: p.to ?? ctx.sender,
        l2Value,
      });

      // viem: if approval needed, don't simulate (would revert due to insufficient allowance).
      // Just return a write-ready request. Otherwise, simulate to capture gas settings.
      let bridgeTx: ViemPlanWriteRequest;
      let resolvedL1GasLimit: bigint | undefined;

      if (needsApprove) {
        bridgeTx = {
          address: ctx.bridgehub,
          abi: IBridgehubABI as Abi,
          functionName: 'requestL2TransactionDirect',
          args: [req],
          value: 0n, // base is ERC-20 ⇒ msg.value MUST be 0
          account: ctx.client.account,
          ...txFeeOverrides,
        } as const;
        resolvedL1GasLimit = gasOverride ?? ctx.l2GasLimit;
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
        bridgeTx = { ...sim.request, ...txFeeOverrides };
        resolvedL1GasLimit = sim.request.gas ?? ctx.l2GasLimit;
      }

      steps.push({
        key: 'bridgehub:direct:erc20-base',
        kind: 'bridgehub:direct',
        description: 'Bridge base ERC-20 via Bridgehub.requestL2TransactionDirect',
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
