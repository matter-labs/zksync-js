// src/adapters/ethers/resources/deposits/routes/erc20-nonbase.ts

import type { DepositRouteStrategy } from './types';
import { AbiCoder, Contract, Interface } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { encodeSecondBridgeErc20Args } from '../../utils';
import { IERC20ABI, IL2AssetRouterABI } from '../../../../../core/abi.ts';
import type { ApprovalNeed, PlanStep } from '../../../../../core/types/flows/base';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { isETH } from '../../../../../core/utils/addr';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';

import { quoteL2BaseCost } from '../services/fee.ts';
import { quoteL1Gas, determineErc20L2Gas } from '../services/gas.ts';
import { L2_ASSET_ROUTER_ADDRESS, SAFE_L1_BRIDGE_GAS } from '../../../../../core/constants.ts';
import {
  applyPriorityL2GasLimitBuffer,
  derivePriorityBodyGasEstimateCap,
} from '../../../../../core/resources/deposits/priority.ts';
import { getPriorityTxGasBreakdown } from './priority';

// error handling
const { wrapAs } = createErrorHandlers('deposits');
const ZERO_L2_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_ASSET_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';

type PriorityGasModel = {
  priorityFloorGasLimit?: bigint;
  undeployedGasLimit?: bigint;
};

async function getPriorityGasModel(input: {
  ctx: Parameters<DepositRouteStrategy['build']>[1];
  token: `0x${string}`;
  amount: bigint;
  receiver: `0x${string}`;
}): Promise<PriorityGasModel> {
  try {
    const l1NativeTokenVault = await input.ctx.contracts.l1NativeTokenVault();
    const l1AssetRouter = await input.ctx.contracts.l1AssetRouter();
    const { chainId: l1ChainId } = await input.ctx.client.l1.getNetwork();
    const isFirstBridge =
      input.ctx.resolvedToken.assetId.toLowerCase() === ZERO_ASSET_ID ||
      input.ctx.resolvedToken.originChainId === 0n;
    const erc20MetadataOriginChainId = isFirstBridge
      ? BigInt(l1ChainId)
      : input.ctx.resolvedToken.originChainId;
    const erc20Metadata = (await l1NativeTokenVault.getERC20Getters(
      input.token,
      erc20MetadataOriginChainId,
    )) as `0x${string}`;
    const bridgeMintCalldata = AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'uint256', 'bytes'],
      [input.ctx.sender, input.receiver, input.token, input.amount, erc20Metadata],
    ) as `0x${string}`;
    const l2Calldata = isFirstBridge
      ? (new Interface(IL2AssetRouterABI).encodeFunctionData(
          'finalizeDeposit(address,address,address,uint256,bytes)',
          [input.ctx.sender, input.receiver, input.token, input.amount, erc20Metadata],
        ) as `0x${string}`)
      : ((await (() => {
          // The asset router derives the real L2 call via `getDepositCalldata(...)`. The token
          // address in bridgeMintData is static-width, so using the L1 token here preserves the
          // exact ABI length while the dynamic metadata bytes still come from NativeTokenVault.
          return l1AssetRouter.getDepositCalldata(
            input.ctx.sender,
            input.ctx.resolvedToken.assetId,
            bridgeMintCalldata,
          );
        })()) as `0x${string}`);
    const priorityFloorBreakdown = getPriorityTxGasBreakdown({
      sender: input.ctx.l1AssetRouter,
      l2Contract: L2_ASSET_ROUTER_ADDRESS,
      l2Value: 0n,
      l2Calldata,
      gasPerPubdata: input.ctx.gasPerPubdata,
    });

    const model: PriorityGasModel = {
      priorityFloorGasLimit: applyPriorityL2GasLimitBuffer({
        chainIdL2: input.ctx.chainIdL2,
        gasLimit: priorityFloorBreakdown.derivedL2GasLimit,
      }),
    };

    if (isFirstBridge || input.ctx.resolvedToken.l2.toLowerCase() === ZERO_L2_TOKEN_ADDRESS) {
      // Fresh deployments on some environments can return unstable low estimates for the exact
      // bridgeMint path. Use the calibrated protocol-floor multiple directly so the quote is
      // stable while still scaling with calldata size and gasPerPubdata.
      model.undeployedGasLimit =
        derivePriorityBodyGasEstimateCap({
          minBodyGas: priorityFloorBreakdown.minBodyGas,
        }) + priorityFloorBreakdown.overhead;
    }

    return model;
  } catch {
    return {};
  }
}

export function routeErc20NonBase(): DepositRouteStrategy {
  return {
    async preflight(p, ctx) {
      const resolved =
        ctx.resolvedToken ??
        (ctx.tokens ? await ctx.tokens.resolve(p.token, { chain: 'l1' }) : undefined);
      const baseToken = ctx.baseTokenL1 ?? (await ctx.client.baseToken(ctx.chainIdL2));
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.nonbase.assertNonBaseToken,
        () => {
          if (resolved?.kind === 'base' || resolved?.kind === 'eth') {
            throw new Error('erc20-nonbase route requires a non-base ERC-20 deposit token.');
          }
        },
        { ctx: { depositToken: p.token, baseToken } },
      );
    },

    async build(p, ctx) {
      const l1Signer = ctx.client.getL1Signer();
      const baseToken = ctx.baseTokenL1 ?? (await ctx.client.baseToken(ctx.chainIdL2));
      const baseIsEth = ctx.baseIsEth ?? isETH(baseToken);
      const receiver = p.to ?? ctx.sender;
      const secondBridgeCalldata = await wrapAs(
        'INTERNAL',
        OP_DEPOSITS.nonbase.encodeCalldata,
        () => Promise.resolve(encodeSecondBridgeErc20Args(p.token, p.amount, receiver)),
        {
          ctx: { where: 'encodeSecondBridgeErc20Args' },
          message: 'Failed to encode bridging calldata.',
        },
      );
      const priorityGasModel = await getPriorityGasModel({
        ctx,
        token: p.token,
        amount: p.amount,
        receiver,
      });

      // Estimating L2 gas for deposits
      // Unique for ERC-20 non-base deposits
      // Need to account for first-time bridged tokens
      // which require a higher gas limit (1M - 3M gas)
      const l2GasParams = await determineErc20L2Gas({
        ctx,
        l1Token: p.token,
        priorityFloorGasLimit: priorityGasModel.priorityFloorGasLimit,
        undeployedGasLimit: priorityGasModel.undeployedGasLimit,
        modelTx: {
          to: receiver,
          from: ctx.sender,
          data: '0x',
          value: 0n,
        },
      });
      // TODO: proper error handling with error envelope
      if (!l2GasParams) throw new Error('Failed to establish L2 gas parameters.');

      // L2TransactionBase cost
      const baseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2GasParams.gasLimit });
      const mintValue = baseCost + ctx.operatorTip;

      //  -- Approvals --
      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<TransactionRequest>[] = [];
      const assetRouter = ctx.l1AssetRouter;

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
        steps.push({
          key: `approve:${p.token}:${assetRouter}`,
          kind: 'approve',
          description: `Approve ${p.amount} for router (deposit token)`,
          tx: {
            to: p.token,
            data: erc20Deposit.interface.encodeFunctionData('approve', [assetRouter, p.amount]),
            from: ctx.sender,
            ...ctx.gasOverrides,
          },
        });
      }

      // If base token is NOT ETH, fees are paid in base ERC-20 ⇒ approve base token for mintValue
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
          steps.push({
            key: `approve:${baseToken}:${assetRouter}`,
            kind: 'approve',
            description: `Approve base token for mintValue`,
            tx: {
              to: baseToken,
              data: erc20Base.interface.encodeFunctionData('approve', [assetRouter, mintValue]),
              from: ctx.sender,
              ...ctx.gasOverrides,
            },
          });
        }
      }

      const requestStruct = {
        chainId: ctx.chainIdL2,
        mintValue,
        l2Value: 0n,
        l2GasLimit: l2GasParams.gasLimit,
        l2GasPerPubdataByteLimit: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        secondBridgeAddress: assetRouter,
        secondBridgeValue: 0n,
        secondBridgeCalldata,
      } as const;

      const bh = await ctx.contracts.bridgehub();
      const data = bh.interface.encodeFunctionData('requestL2TransactionTwoBridges', [
        requestStruct,
      ]);

      // If Base is ETH, we attach value to the tx.
      // If Base is ERC20, we send 0 ETH (fees pulled via transferFrom).
      const txValue = baseIsEth ? mintValue : 0n;
      // If base = ETH ⇒ msg.value must equal mintValue. Else ⇒ msg.value = 0.
      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data,
        value: txValue,
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
        key: 'bridgehub:two-bridges',
        kind: 'bridgehub:two-bridges',
        description: baseIsEth
          ? 'Bridge ERC-20 (Fees paid in ETH)'
          : 'Bridge ERC-20 (Fees paid in Base Token)',
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
