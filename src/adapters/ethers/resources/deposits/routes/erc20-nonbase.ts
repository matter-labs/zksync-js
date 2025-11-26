// src/adapters/ethers/resources/deposits/routes/erc20-nonbase.ts

import type { DepositRouteStrategy } from './types';
import { Contract } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { encodeSecondBridgeErc20Args } from '../../utils';
import { IERC20ABI, IBridgehubABI } from '../../../../../core/abi.ts';
import type { ApprovalNeed, PlanStep } from '../../../../../core/types/flows/base';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { isETH, normalizeAddrEq } from '../../../../../core/utils/addr';

// error handling
const { wrapAs } = createErrorHandlers('deposits');

// TODO: all gas buffers need to be moved to a dedicated resource
const MIN_L2_GAS_FOR_ERC20 = 2_500_000n;

export function routeErc20NonBase(): DepositRouteStrategy {
  return {
    async preflight() {
      // TODO: move validations here
    },

    async build(p, ctx) {
      const bh = new Contract(ctx.bridgehub, IBridgehubABI, ctx.client.l1);
      const assetRouter = ctx.l1AssetRouter;
      const { gasPriceForBaseCost, gasLimit: overrideGasLimit, ...txFeeOverrides } = ctx.fee;
      const txOverrides =
        overrideGasLimit != null
          ? { ...txFeeOverrides, gasLimit: overrideGasLimit }
          : txFeeOverrides;
      let resolvedL1GasLimit: bigint = overrideGasLimit ?? ctx.l2GasLimit;

      // Resolve target base token once
      const baseToken = (await wrapAs(
        'CONTRACT',
        OP_DEPOSITS.nonbase.baseToken ?? 'deposits.erc20-nonbase:baseToken',
        () => bh.baseToken(ctx.chainIdL2),
        {
          ctx: { where: 'bridgehub.baseToken', chainIdL2: ctx.chainIdL2 },
          message: 'Failed to read base token.',
        },
      )) as `0x${string}`;

      // Safety: this route is only for "deposit token ≠ base token"
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

      // TODO: refactor to improve gas estimate / fees
      const l2GasLimitUsed =
        ctx.l2GasLimit && ctx.l2GasLimit > 0n
          ? ctx.l2GasLimit < MIN_L2_GAS_FOR_ERC20
            ? MIN_L2_GAS_FOR_ERC20
            : ctx.l2GasLimit
          : MIN_L2_GAS_FOR_ERC20;

      const rawBaseCost = (await wrapAs(
        'RPC',
        OP_DEPOSITS.nonbase.baseCost,
        () =>
          bh.l2TransactionBaseCost(
            ctx.chainIdL2,
            gasPriceForBaseCost,
            l2GasLimitUsed,
            ctx.gasPerPubdata,
          ),
        {
          ctx: { where: 'l2TransactionBaseCost', chainIdL2: ctx.chainIdL2 },
          message: 'Could not fetch L2 base cost from Bridgehub.',
        },
      )) as bigint;

      const baseCost = BigInt(rawBaseCost);
      const mintValue = baseCost + ctx.operatorTip;

      // Approvals (branch by who pays fees)
      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<TransactionRequest>[] = [];

      const l1Signer = ctx.client.getL1Signer();

      // Always ensure deposit token approval for the amount
      {
        const erc20Deposit = new Contract(p.token, IERC20ABI, l1Signer);
        const allowanceToken: bigint = (await wrapAs(
          'RPC',
          OP_DEPOSITS.nonbase.allowanceToken,
          () => erc20Deposit.allowance(ctx.sender, assetRouter),
          {
            ctx: { where: 'erc20.allowance', token: p.token, spender: assetRouter },
            message: 'Failed to read deposit-token allowance.',
          },
        )) as bigint;

        if (allowanceToken < p.amount) {
          approvals.push({ token: p.token, spender: assetRouter, amount: p.amount });
          const data = erc20Deposit.interface.encodeFunctionData('approve', [
            assetRouter,
            p.amount,
          ]);
          steps.push({
            key: `approve:${p.token}:${assetRouter}`,
            kind: 'approve',
            description: `Approve ${p.amount} for router (deposit token)`,
            tx: { to: p.token, data, from: ctx.sender, ...txOverrides },
          });
        }
      }

      // If base token is NOT ETH, fees are paid in base ERC-20 ⇒ approve base token for mintValue
      const baseIsEth = isETH(baseToken);
      if (!baseIsEth) {
        const erc20Base = new Contract(baseToken, IERC20ABI, l1Signer);
        const allowanceBase: bigint = (await wrapAs(
          'RPC',
          OP_DEPOSITS.nonbase.allowanceBase,
          () => erc20Base.allowance(ctx.sender, assetRouter),
          {
            ctx: { where: 'erc20.allowance', token: baseToken, spender: assetRouter },
            message: 'Failed to read base-token allowance.',
          },
        )) as bigint;

        if (allowanceBase < mintValue) {
          approvals.push({ token: baseToken, spender: assetRouter, amount: mintValue });
          const data = erc20Base.interface.encodeFunctionData('approve', [assetRouter, mintValue]);
          steps.push({
            key: `approve:${baseToken}:${assetRouter}`,
            kind: 'approve',
            description: `Approve base token for mintValue`,
            tx: { to: baseToken, data, from: ctx.sender, ...txOverrides },
          });
        }
      }

      const secondBridgeCalldata = await wrapAs(
        'INTERNAL',
        OP_DEPOSITS.nonbase.encodeCalldata,
        () => Promise.resolve(encodeSecondBridgeErc20Args(p.token, p.amount, p.to ?? ctx.sender)),
        {
          ctx: { where: 'encodeSecondBridgeErc20Args' },
          message: 'Failed to encode bridging calldata.',
        },
      );

      const outer = {
        chainId: ctx.chainIdL2,
        mintValue, // fees (in ETH if base=ETH, else pulled as base ERC-20)
        l2Value: 0n,
        l2GasLimit: l2GasLimitUsed,
        l2GasPerPubdataByteLimit: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        secondBridgeAddress: assetRouter,
        secondBridgeValue: 0n,
        secondBridgeCalldata,
      } as const;

      const dataTwo = bh.interface.encodeFunctionData('requestL2TransactionTwoBridges', [outer]);

      // If base = ETH ⇒ msg.value must equal mintValue. Else ⇒ msg.value = 0.
      const bridgeTx: TransactionRequest = {
        to: ctx.bridgehub,
        data: dataTwo,
        value: baseIsEth ? mintValue : 0n,
        from: ctx.sender,
        ...txOverrides,
      };

      if (overrideGasLimit != null) {
        bridgeTx.gasLimit = overrideGasLimit;
        resolvedL1GasLimit = overrideGasLimit;
      } else {
        try {
          const est = await wrapAs(
            'RPC',
            OP_DEPOSITS.nonbase.estGas,
            () => ctx.client.l1.estimateGas(bridgeTx),
            {
              ctx: { where: 'l1.estimateGas', to: ctx.bridgehub, baseIsEth },
              message: 'Failed to estimate gas for Bridgehub request.',
            },
          );
          // TODO: refactor to improve gas estimate / fees
          const buffered = (BigInt(est) * 125n) / 100n;
          bridgeTx.gasLimit = buffered;
          resolvedL1GasLimit = buffered;
        } catch {
          // ignore;
        }
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
        quoteExtras: { baseCost, mintValue, baseToken, baseIsEth, l1GasLimit: resolvedL1GasLimit },
      };
    },
  };
}
