// src/adapters/viem/resources/deposits/routes/eth-nonbase.ts

import type { DepositRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep, ApprovalNeed } from '../../../../../core/types/flows/base';
import {
  type AbiParameter,
  type Abi,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  zeroAddress,
} from 'viem';
import type { TransactionRequest } from 'viem';

import { IBridgehubABI, IERC20ABI } from '../../../../../core/abi.ts';
import { createNTVCodec } from '../../../../../core/codec/ntv.ts';
import { encodeSecondBridgeEthArgs } from '../../utils';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { isETH } from '../../../../../core/utils/addr';
import {
  ETH_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
  SAFE_L1_BRIDGE_GAS,
} from '../../../../../core/constants.ts';

import { determineEthNonBaseL2Gas, quoteL1Gas } from '../services/gas.ts';
import { quoteL2BaseCost } from '../services/fee.ts';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';
import {
  applyPriorityL2GasLimitBuffer,
  derivePriorityBodyGasEstimateCap,
} from '../../../../../core/resources/deposits/priority.ts';
import { getPriorityTxGasBreakdown } from './priority';

const { wrapAs } = createErrorHandlers('deposits');
const ZERO_ASSET_ID = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;
const ntvCodec = createNTVCodec({
  encode: (types, values) =>
    encodeAbiParameters(
      types.map((type, index) => ({ type, name: `arg${index}` })) as AbiParameter[],
      values,
    ),
  keccak256,
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
        : BigInt(await input.ctx.client.l1.getChainId());
    const resolvedAssetId =
      input.ctx.resolvedToken.assetId.toLowerCase() === ZERO_ASSET_ID
        ? ntvCodec.encodeAssetId(originChainId, L2_NATIVE_TOKEN_VAULT_ADDRESS, ETH_ADDRESS)
        : input.ctx.resolvedToken.assetId;
    const erc20Metadata = await l1NativeTokenVault.read.getERC20Getters([
      ETH_ADDRESS,
      originChainId,
    ]);
    const bridgeMintCalldata = encodeAbiParameters(
      [
        { type: 'address', name: 'originalCaller' },
        { type: 'address', name: 'receiver' },
        { type: 'address', name: 'originToken' },
        { type: 'uint256', name: 'amount' },
        { type: 'bytes', name: 'erc20Metadata' },
      ],
      [input.ctx.sender, input.receiver, ETH_ADDRESS, input.amount, erc20Metadata],
    );
    const l2Calldata = await l1AssetRouter.read.getDepositCalldata([
      input.ctx.sender,
      resolvedAssetId,
      bridgeMintCalldata,
    ]);
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

    if (input.ctx.resolvedToken.l2.toLowerCase() === zeroAddress) {
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

// ETH deposit to a chain whose base token is NOT ETH.
export function routeEthNonBase(): DepositRouteStrategy {
  return {
    // TODO: do we even need these validations?
    async preflight(p, ctx) {
      await wrapAs(
        'VALIDATION',
        OP_DEPOSITS.ethNonBase.assertEthAsset,
        () => {
          if (ctx.resolvedToken?.kind !== 'eth' && !isETH(p.token)) {
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
    },

    async build(p, ctx) {
      const baseToken = ctx.baseTokenL1 ?? (await ctx.client.baseToken(ctx.chainIdL2));
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
      const l2Gas = await determineEthNonBaseL2Gas({
        ctx,
        modelTx: l2TxModel,
        priorityFloorGasLimit: priorityGasModel.priorityFloorGasLimit,
        undeployedGasLimit: priorityGasModel.undeployedGasLimit,
      });

      if (!l2Gas) throw new Error('Failed to estimate L2 gas parameters.');

      // L2TransactionBase cost
      const l2BaseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2Gas.gasLimit });
      const mintValue = l2BaseCost + ctx.operatorTip;

      // -- Approvals --
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
          description: `Approve base token for fees (mintValue)`,
          tx: { ...approveSim.request },
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
          message: 'Failed to encode ETH bridging calldata.',
        },
      );

      const requestStruct = {
        chainId: ctx.chainIdL2,
        mintValue,
        l2Value: 0n,
        l2GasLimit: l2Gas.gasLimit,
        l2GasPerPubdataByteLimit: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        secondBridgeAddress: ctx.l1AssetRouter,
        secondBridgeValue: p.amount,
        secondBridgeCalldata,
      } as const;
      // For ETH deposits on custom-base-token chains:
      // - outer Bridgehub msg.value must equal secondBridgeValue
      // - inner asset-router / NTV path requires l2Value to stay zero
      const bridgehubValue = p.amount;

      let bridgeTx: ViemPlanWriteRequest;
      let calldata: `0x${string}`;

      if (needsApprove) {
        bridgeTx = {
          address: ctx.bridgehub,
          abi: IBridgehubABI,
          functionName: 'requestL2TransactionTwoBridges',
          args: [requestStruct],
          value: bridgehubValue,
          account: ctx.client.account,
        } as const;

        calldata = encodeFunctionData({
          abi: IBridgehubABI as Abi,
          functionName: 'requestL2TransactionTwoBridges',
          args: [requestStruct],
        });
      } else {
        const sim = await wrapAs(
          'CONTRACT',
          OP_DEPOSITS.ethNonBase.estGas,
          () =>
            ctx.client.l1.simulateContract({
              address: ctx.bridgehub,
              abi: IBridgehubABI,
              functionName: 'requestL2TransactionTwoBridges',
              args: [requestStruct],
              value: bridgehubValue,
              account: ctx.client.account,
            }),
          {
            ctx: { where: 'l1.simulateContract', to: ctx.bridgehub },
            message: 'Failed to simulate Bridgehub two-bridges request.',
          },
        );

        calldata = encodeFunctionData({
          abi: sim.request.abi as Abi,
          functionName: sim.request.functionName,
          args: sim.request.args,
        });

        bridgeTx = { ...sim.request };
      }

      // --- Estimate L1 Gas ---
      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data: calldata,
        value: bridgehubValue,
        from: ctx.sender,
        ...ctx.gasOverrides,
      };
      const l1Gas = await quoteL1Gas({
        ctx,
        tx: l1TxCandidate,
        overrides: ctx.gasOverrides,
        fallbackGasLimit: SAFE_L1_BRIDGE_GAS,
      });

      if (l1Gas) {
        bridgeTx = {
          ...bridgeTx,
          gas: l1Gas.gasLimit,
          maxFeePerGas: l1Gas.maxFeePerGas,
          maxPriorityFeePerGas: l1Gas.maxPriorityFeePerGas,
        };
      }

      steps.push({
        key: 'bridgehub:two-bridges:eth-nonbase',
        kind: 'bridgehub:two-bridges',
        description:
          'Bridge ETH (fees in base ERC-20) via Bridgehub.requestL2TransactionTwoBridges',
        tx: bridgeTx,
      });

      const fees = buildFeeBreakdown({
        feeToken: baseToken,
        l1Gas,
        l2Gas,
        l2BaseCost,
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
