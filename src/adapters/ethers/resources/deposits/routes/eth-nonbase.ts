// src/adapters/ethers/resources/deposits/routes/eth-nonbase.ts

import type { DepositRouteStrategy } from './types';
import { AbiCoder, Contract, keccak256 } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { IERC20ABI } from '../../../../../core/abi.ts';
import { createNTVCodec } from '../../../../../core/codec/ntv.ts';
import { encodeSecondBridgeEthArgs } from '../../utils';
import type { ApprovalNeed, PlanStep } from '../../../../../core/types/flows/base';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { isETH } from '../../../../../core/utils/addr';
import { determineEthNonBaseL2Gas, quoteL1Gas } from '../services/gas.ts';
import { quoteL2BaseCost } from '../services/fee.ts';
import {
  ETH_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
  SAFE_L1_BRIDGE_GAS,
} from '../../../../../core/constants.ts';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';
import { derivePriorityBodyGasEstimateCap } from '../../../../../core/resources/deposits/priority.ts';
import { getPriorityTxGasBreakdown } from './priority';
import type { Hex } from '../../../../../core/types/primitives';

// error handling
const { wrapAs } = createErrorHandlers('deposits');
const ZERO_L2_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_ASSET_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ntvCodec = createNTVCodec({
  encode: (types, values) => AbiCoder.defaultAbiCoder().encode(types, values) as Hex,
  keccak256: (data) => keccak256(data) as Hex,
});

type PriorityGasModel = {
  priorityFloorGasLimit?: bigint;
  undeployedGasLimit?: bigint;
};

async function getPriorityGasModel(input: {
  ctx: Parameters<DepositRouteStrategy['build']>[1];
  amount: bigint;
  receiver: `0x${string}`;
}): Promise<PriorityGasModel> {
  try {
    const l1AssetRouter = await input.ctx.contracts.l1AssetRouter();
    const l1NativeTokenVault = await input.ctx.contracts.l1NativeTokenVault();
    const originChainId =
      input.ctx.resolvedToken.originChainId !== 0n
        ? input.ctx.resolvedToken.originChainId
        : BigInt((await input.ctx.client.l1.getNetwork()).chainId);
    const resolvedAssetId =
      input.ctx.resolvedToken.assetId.toLowerCase() === ZERO_ASSET_ID
        ? ntvCodec.encodeAssetId(originChainId, L2_NATIVE_TOKEN_VAULT_ADDRESS, ETH_ADDRESS)
        : input.ctx.resolvedToken.assetId;
    const erc20Metadata = (await l1NativeTokenVault.getERC20Getters(
      ETH_ADDRESS,
      originChainId,
    )) as `0x${string}`;
    const bridgeMintCalldata = AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'uint256', 'bytes'],
      [input.ctx.sender, input.receiver, ETH_ADDRESS, input.amount, erc20Metadata],
    ) as `0x${string}`;
    const l2Calldata = (await l1AssetRouter.getDepositCalldata(
      input.ctx.sender,
      resolvedAssetId,
      bridgeMintCalldata,
    )) as `0x${string}`;
    const priorityFloorBreakdown = getPriorityTxGasBreakdown({
      sender: input.ctx.l1AssetRouter,
      l2Contract: L2_ASSET_ROUTER_ADDRESS,
      l2Value: 0n,
      l2Calldata,
      gasPerPubdata: input.ctx.gasPerPubdata,
    });

    const model: PriorityGasModel = {
      priorityFloorGasLimit: priorityFloorBreakdown.derivedL2GasLimit,
    };

    if (input.ctx.resolvedToken.l2.toLowerCase() === ZERO_L2_TOKEN_ADDRESS) {
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

// ETH deposit to a chain whose base token is NOT ETH.
export function routeEthNonBase(): DepositRouteStrategy {
  return {
    async preflight(p, ctx) {
      const resolved =
        ctx.resolvedToken ??
        (ctx.tokens ? await ctx.tokens.resolve(p.token, { chain: 'l1' }) : undefined);
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.ethNonBase.assertEthAsset,
        () => {
          if (resolved?.kind !== 'eth' && !isETH(p.token)) {
            throw new Error('eth-nonbase route requires ETH as the deposit asset.');
          }
        },
        { ctx: { token: p.token } },
      );
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.ethNonBase.assertNonEthBase,
        () => {
          if (ctx.baseIsEth) {
            throw new Error('eth-nonbase route requires target chain base token ≠ ETH.');
          }
        },
        { ctx: { baseIsEth: ctx.baseIsEth, chainIdL2: ctx.chainIdL2 } },
      );
      // Check sufficient ETH balance to cover deposit amount
      const ethBal = await wrapAs(
        'RPC',
        OP_DEPOSITS.ethNonBase.ethBalance,
        () => ctx.client.l1.getBalance(ctx.sender),
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
      const l1Signer = ctx.client.getL1Signer();
      const baseToken = ctx.baseTokenL1;
      const receiver = p.to ?? ctx.sender;
      const priorityGasModel = await getPriorityGasModel({
        ctx,
        amount: p.amount,
        receiver,
      });

      // TX request created for gas estimation only
      const l2TxModel: TransactionRequest = {
        to: receiver,
        from: ctx.sender,
        data: '0x',
        value: 0n,
      };
      const l2GasParams = await determineEthNonBaseL2Gas({
        ctx,
        modelTx: l2TxModel,
        priorityFloorGasLimit: priorityGasModel.priorityFloorGasLimit,
        undeployedGasLimit: priorityGasModel.undeployedGasLimit,
      });
      if (!l2GasParams) throw new Error('Failed to estimate L2 gas parameters.');

      // L2TransactionBase cost
      const baseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2GasParams.gasLimit });
      const mintValue = baseCost + ctx.operatorTip;

      // --- Approvals ---
      const approvals: ApprovalNeed[] = [];
      const steps: PlanStep<TransactionRequest>[] = [];

      const erc20Base = new Contract(baseToken, IERC20ABI, l1Signer);
      const allowance = (await wrapAs(
        'RPC',
        OP_DEPOSITS.ethNonBase.allowanceBase,
        () => erc20Base.allowance(ctx.sender, ctx.l1AssetRouter),
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
          description: `Approve base token for fees (mintValue)`,
          tx: {
            to: baseToken,
            data: erc20Base.interface.encodeFunctionData('approve', [ctx.l1AssetRouter, mintValue]),
            from: ctx.sender,
            ...ctx.gasOverrides,
          },
        });
      }

      const secondBridgeCalldata = await wrapAs(
        'INTERNAL',
        OP_DEPOSITS.ethNonBase.encodeCalldata,
        () => Promise.resolve(encodeSecondBridgeEthArgs(p.amount, receiver)),
        {
          ctx: {
            where: 'encodeSecondBridgeEthArgs',
            amount: p.amount.toString(),
            to: receiver,
          },
        },
      );

      const requestStruct = {
        chainId: ctx.chainIdL2,
        mintValue,
        l2Value: p.amount,
        l2GasLimit: l2GasParams.gasLimit,
        l2GasPerPubdataByteLimit: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        secondBridgeAddress: ctx.l1AssetRouter,
        secondBridgeValue: p.amount,
        secondBridgeCalldata,
      } as const;

      const bridgehub = await ctx.contracts.bridgehub();
      const data = bridgehub.interface.encodeFunctionData('requestL2TransactionTwoBridges', [
        requestStruct,
      ]);

      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data,
        value: p.amount, // base ≠ ETH ⇒ msg.value == secondBridgeValue
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
        key: 'bridgehub:two-bridges:eth-nonbase',
        kind: 'bridgehub:two-bridges',
        description:
          'Bridge ETH (fees in base ERC-20) via Bridgehub.requestL2TransactionTwoBridges',
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
