import type { DepositRouteStrategy } from './types';
import { Contract } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { IBridgehubABI, IERC20ABI } from '../../../../../core/abi.ts';
import { buildDirectRequestStruct } from '../../utils';
import type { ApprovalNeed, PlanStep } from '../../../../../core/types/flows/base';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { normalizeAddrEq, isETH } from '../../../../../core/utils/addr';
import { SAFE_L1_BRIDGE_GAS } from '../../../../../core/constants.ts';
import { quoteL1Gas, quoteL2Gas } from '../services/gas.ts';
import { quoteL2BaseCost } from '../services/fee.ts';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';

// error handling
const { wrapAs } = createErrorHandlers('deposits');

//  ERC20 deposit where the deposit token IS the target chain's base token (base ≠ ETH).
export function routeErc20Base(): DepositRouteStrategy {
  return {
    async preflight(p, ctx) {
      const resolved =
        ctx.resolvedToken ??
        (ctx.tokens ? await ctx.tokens.resolve(p.token, { chain: 'l1' }) : undefined);
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.base.assertErc20Asset,
        () => {
          if (resolved?.kind === 'eth' || isETH(p.token)) {
            throw new Error('erc20-base route requires an ERC-20 token (not ETH).');
          }
        },
        { ctx: { token: p.token } },
      );

      // Check provided token matches target chain base token
      const baseToken = ctx.baseTokenL1 ?? (await ctx.client.baseToken(ctx.chainIdL2));
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
      const l1Signer = ctx.client.getL1Signer();
      const baseToken = ctx.baseTokenL1 ?? (await ctx.client.baseToken(ctx.chainIdL2));

      // TX request created for gas estimation only
      const l2TxModel: TransactionRequest = {
        to: p.to ?? ctx.sender,
        from: ctx.sender,
        data: '0x',
        value: 0n,
      };
      const l2GasParams = await quoteL2Gas({
        ctx,
        route: 'erc20-base',
        l2TxForModeling: l2TxModel,
        overrideGasLimit: ctx.l2GasLimit,
      });

      // TODO: proper error handling
      if (!l2GasParams) throw new Error('Failed to estimate L2 gas parameters.');

      // L2TransactionBase cost
      const baseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2GasParams.gasLimit });
      const mintValue = baseCost + ctx.operatorTip + p.amount;

      // --- Approvals ---
      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<TransactionRequest>[] = [];

      // Check allowance for base token -> L1AssetRouter
      {
        const erc20 = new Contract(baseToken, IERC20ABI, l1Signer);
        const allowance = (await wrapAs(
          'RPC',
          OP_DEPOSITS.base.allowance,
          () => erc20.allowance(ctx.sender, ctx.l1AssetRouter),
          {
            ctx: { where: 'erc20.allowance', token: baseToken, spender: ctx.l1AssetRouter },
            message: 'Failed to read base-token allowance.',
          },
        )) as bigint;

        if (allowance < mintValue) {
          approvals.push({ token: baseToken, spender: ctx.l1AssetRouter, amount: mintValue });
          steps.push({
            key: `approve:${baseToken}:${ctx.l1AssetRouter}`,
            kind: 'approve',
            description: 'Approve base token for mintValue',
            tx: {
              to: baseToken,
              data: erc20.interface.encodeFunctionData('approve', [ctx.l1AssetRouter, mintValue]),
              from: ctx.sender,
              ...ctx.gasOverrides,
            },
          });
        }
      }

      const requestStruct = buildDirectRequestStruct({
        chainId: ctx.chainIdL2,
        mintValue,
        l2GasLimit: l2GasParams.gasLimit,
        gasPerPubdata: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        l2Contract: p.to ?? ctx.sender,
        l2Value: p.amount,
      });

      const data = new Contract(
        ctx.bridgehub,
        IBridgehubABI,
        ctx.client.l1,
      ).interface.encodeFunctionData('requestL2TransactionDirect', [requestStruct]);

      // --- Estimate L1 Gas ---
      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data,
        value: 0n, // base token is ERC-20 ⇒ msg.value MUST be 0
        from: ctx.sender,
        ...ctx.gasOverrides,
      };
      const l1GasParams = await quoteL1Gas({
        ctx,
        tx: l1TxCandidate,
        overrides: ctx.gasOverrides,
        fallbackGasLimit: SAFE_L1_BRIDGE_GAS,
      });
      if (l1GasParams) {
        l1TxCandidate.gasLimit = l1GasParams.gasLimit;
        l1TxCandidate.maxFeePerGas = l1GasParams.maxFeePerGas;
        l1TxCandidate.maxPriorityFeePerGas = l1GasParams.maxPriorityFeePerGas;
      }

      steps.push({
        key: 'bridgehub:direct:erc20-base',
        kind: 'bridgehub:direct',
        description: 'Bridge base ERC-20 via Bridgehub.requestL2TransactionDirect',
        tx: l1TxCandidate,
      });

      const fees = buildFeeBreakdown({
        feeToken: baseToken,
        l1Gas: l1GasParams,
        l2Gas: l2GasParams,
        l2BaseCost: baseCost,
        operatorTip: ctx.operatorTip,
        mintValue,
      });

      return {
        steps,
        approvals,
        fees,
      };
    },
  };
}
