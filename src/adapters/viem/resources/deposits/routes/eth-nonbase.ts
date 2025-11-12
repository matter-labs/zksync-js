// src/adapters/viem/resources/deposits/routes/eth-nonbase.ts

import type { DepositRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';
import { IBridgehubABI, IERC20ABI } from '../../../../../core/internal/abi-registry.ts';
import { encodeSecondBridgeEthArgs, buildViemFeeOverrides } from '../../utils';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { isETH } from '../../../../../core/utils/addr';
import type { Abi } from 'viem';

// error handling
const { wrapAs } = createErrorHandlers('deposits');

// TODO: all gas buffers need to be moved to a dedicated resource
// this is getting messy
const BASE_COST_BUFFER_BPS = 100n; // 1%
const BPS = 10_000n;
const withBuffer = (x: bigint) => (x * (BPS + BASE_COST_BUFFER_BPS)) / BPS;

// ETH deposit to a chain whose base token is NOT ETH.
export function routeEthNonBase(): DepositRouteStrategy {
  return {
    async preflight(p, ctx) {
      // Assert the asset is ETH.
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.ethNonBase.assertEthAsset,
        () => {
          if (!isETH(p.token)) {
            throw new Error('eth-nonbase route requires ETH as the deposit asset.');
          }
        },
        { ctx: { token: p.token } },
      );

      // Resolve base token & assert it's not ETH on target chain.
      const baseToken = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.ethNonBase.baseToken,
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
        OP_DEPOSITS.ethNonBase.assertNonEthBase,
        () => {
          if (isETH(baseToken)) {
            throw new Error('eth-nonbase route requires target chain base token ≠ ETH.');
          }
        },
        { ctx: { baseToken, chainIdL2: ctx.chainIdL2 } },
      );

      // Ensure user has enough ETH for the deposit amount (msg.value).
      const ethBal = await wrapAs(
        'RPC',
        OP_DEPOSITS.ethNonBase.ethBalance,
        () => ctx.client.l1.getBalance({ address: ctx.sender }),
        {
          ctx: { where: 'l1.getBalance', sender: ctx.sender },
          message: 'Failed to read L1 ETH balance.',
        },
      );

      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.ethNonBase.assertEthBalance,
        () => {
          if (ethBal < p.amount) {
            throw new Error('Insufficient L1 ETH balance to cover deposit amount.');
          }
        },
        { ctx: { required: p.amount.toString(), balance: ethBal.toString() } },
      );

      return;
    },

    async build(p, ctx) {
      const { gasPriceForBaseCost } = ctx.fee;
      const txFeeOverrides = buildViemFeeOverrides(ctx.fee);

      // Resolve base token
      const baseToken = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.ethNonBase.baseToken,
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

      // Compute baseCost / mintValue
      const rawBaseCost = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.ethNonBase.baseCost,
        () =>
          ctx.client.l1.readContract({
            address: ctx.bridgehub,
            abi: IBridgehubABI as Abi,
            functionName: 'l2TransactionBaseCost',
            args: [ctx.chainIdL2, gasPriceForBaseCost, ctx.l2GasLimit, ctx.gasPerPubdata],
          }),
        {
          ctx: { where: 'l2TransactionBaseCost', chainIdL2: ctx.chainIdL2 },
          message: 'Could not fetch L2 base cost.',
        },
      )) as bigint;

      const baseCost = BigInt(rawBaseCost);
      const mintValueRaw = baseCost + ctx.operatorTip;
      const mintValue = withBuffer(mintValueRaw);

      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<ViemPlanWriteRequest>[] = [];

      const allowance = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.ethNonBase.allowanceBase,
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

      const needsApprove = allowance < mintValue;

      if (needsApprove) {
        const approveSim = await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.ethNonBase.estGas,
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
          tx: { ...approveSim.request },
        });
      }

      const secondBridgeCalldata = await wrapAs(
        'INTERNAL',
        OP_DEPOSITS.ethNonBase.encodeCalldata,
        () => Promise.resolve(encodeSecondBridgeEthArgs(p.amount, p.to ?? ctx.sender)),
        {
          ctx: {
            where: 'encodeSecondBridgeEthArgs',
            amount: p.amount.toString(),
            to: p.to ?? ctx.sender,
          },
          message: 'Failed to encode ETH bridging calldata.',
        },
      );

      const outer = {
        chainId: ctx.chainIdL2,
        mintValue,
        l2Value: 0n,
        l2GasLimit: ctx.l2GasLimit,
        l2GasPerPubdataByteLimit: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        secondBridgeAddress: ctx.l1AssetRouter,
        secondBridgeValue: p.amount,
        secondBridgeCalldata,
      } as const;

      // viem: if approval needed, don't simulate the bridge call (could revert).
      // Return a write-ready request with correct `value = p.amount`.
      let bridgeTx: ViemPlanWriteRequest;
      let resolvedL1GasLimit: bigint | undefined;

      if (needsApprove) {
        bridgeTx = {
          address: ctx.bridgehub,
          abi: IBridgehubABI,
          functionName: 'requestL2TransactionTwoBridges',
          args: [outer],
          value: p.amount, // base ≠ ETH ⇒ msg.value == secondBridgeValue
          account: ctx.client.account,
        } as const;
        resolvedL1GasLimit = ctx.l2GasLimit;
      } else {
        const twoBridgesSim = await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.ethNonBase.estGas,
          () =>
            ctx.client.l1.simulateContract({
              address: ctx.bridgehub,
              abi: IBridgehubABI,
              functionName: 'requestL2TransactionTwoBridges',
              args: [outer],
              value: p.amount, // base ≠ ETH ⇒ msg.value == secondBridgeValue
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'l1.simulateContract', to: ctx.bridgehub },
            message: 'Failed to simulate Bridgehub two-bridges request.',
          },
        );
        bridgeTx = { ...twoBridgesSim.request, ...txFeeOverrides };
        resolvedL1GasLimit = twoBridgesSim.request.gas ?? ctx.l2GasLimit;
      }

      steps.push({
        key: 'bridgehub:two-bridges:eth-nonbase',
        kind: 'bridgehub:two-bridges',
        description:
          'Bridge ETH (fees in base ERC-20) via Bridgehub.requestL2TransactionTwoBridges',
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
