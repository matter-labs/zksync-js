// src/adapters/viem/resources/deposits/routes/eth.ts

import type { TransactionRequest } from 'viem';
import { encodeAbiParameters, encodeFunctionData } from 'viem';
import type { DepositRouteStrategy, ViemPlanWriteRequest } from './types';
import type { PlanStep } from '../../../../../core/types/flows/base';
import type { Address, Hex } from '../../../../../core/types/primitives';
import { buildDirectRequestStruct } from '../../utils';
import { IBridgehubABI } from '../../../../../core/abi.ts';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_DEPOSITS } from '../../../../../core/types';
import { quoteL2Gas, quoteL1Gas } from '../services/gas.ts';
import { quoteL2BaseCost } from '../services/fee.ts';
import { ETH_ADDRESS } from '../../../../../core/constants.ts';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';
import { deriveDirectPriorityTxGasBreakdown } from '../../../../../core/resources/deposits/priority.ts';

// error handling
const { wrapAs } = createErrorHandlers('deposits');
const EMPTY_BYTES = '0x' as Hex;
const ZERO_RESERVED_WORDS = [0n, 0n, 0n, 0n] as const;
const L2_CANONICAL_TRANSACTION_PARAMETER = {
  type: 'tuple',
  components: [
    { name: 'txType', type: 'uint256' },
    { name: 'from', type: 'uint256' },
    { name: 'to', type: 'uint256' },
    { name: 'gasLimit', type: 'uint256' },
    { name: 'gasPerPubdataByteLimit', type: 'uint256' },
    { name: 'maxFeePerGas', type: 'uint256' },
    { name: 'maxPriorityFeePerGas', type: 'uint256' },
    { name: 'paymaster', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'value', type: 'uint256' },
    { name: 'reserved', type: 'uint256[4]' },
    { name: 'data', type: 'bytes' },
    { name: 'signature', type: 'bytes' },
    { name: 'factoryDeps', type: 'uint256[]' },
    { name: 'paymasterInput', type: 'bytes' },
    { name: 'reservedDynamic', type: 'bytes' },
  ],
} as const;

function hexByteLength(hex: Hex): bigint {
  return BigInt(Math.max(hex.length - 2, 0) / 2);
}

// Mailbox validates the direct priority request using `abi.encode(transaction)`, so the
// quote path mirrors that exact tuple shape instead of approximating a fixed encoded size.
function getDirectPriorityTxEncodedLength(input: {
  sender: Address;
  l2Contract: Address;
  l2Value: bigint;
  l2Calldata: Hex;
  gasPerPubdata: bigint;
}): bigint {
  const encoded = encodeAbiParameters(
    [L2_CANONICAL_TRANSACTION_PARAMETER],
    [
      {
        txType: 0n,
        from: BigInt(input.sender),
        to: BigInt(input.l2Contract),
        gasLimit: 0n,
        gasPerPubdataByteLimit: input.gasPerPubdata,
        maxFeePerGas: 0n,
        maxPriorityFeePerGas: 0n,
        paymaster: 0n,
        nonce: 0n,
        value: input.l2Value,
        reserved: ZERO_RESERVED_WORDS,
        data: input.l2Calldata,
        signature: EMPTY_BYTES,
        factoryDeps: [],
        paymasterInput: EMPTY_BYTES,
        reservedDynamic: EMPTY_BYTES,
      },
    ],
  );

  return hexByteLength(encoded);
}

// ETH deposit route via Bridgehub.requestL2TransactionDirect
// ETH is base token
export function routeEthDirect(): DepositRouteStrategy {
  return {
    async build(p, ctx) {
      const l2Contract = p.to ?? ctx.sender;
      const l2Value = p.amount;
      const l2Calldata = EMPTY_BYTES;

      const priorityFloorBreakdown = deriveDirectPriorityTxGasBreakdown({
        encodedLength: getDirectPriorityTxEncodedLength({
          sender: ctx.sender,
          l2Contract,
          l2Value,
          l2Calldata,
          gasPerPubdata: ctx.gasPerPubdata,
        }),
        gasPerPubdata: ctx.gasPerPubdata,
      });

      const quotedL2GasLimit = ctx.l2GasLimit ?? priorityFloorBreakdown.derivedL2GasLimit;

      const l2GasParams = await quoteL2Gas({
        ctx,
        route: 'eth-base',
        overrideGasLimit: quotedL2GasLimit,
      });

      // TODO: proper error handling
      if (!l2GasParams) {
        throw new Error('Failed to estimate L2 gas for deposit.');
      }

      // L2TransactionBase cost
      const baseCost = await quoteL2BaseCost({ ctx, l2GasLimit: l2GasParams.gasLimit });

      const mintValue = baseCost + ctx.operatorTip + l2Value;

      const req = buildDirectRequestStruct({
        chainId: ctx.chainIdL2,
        mintValue,
        l2GasLimit: l2GasParams.gasLimit,
        gasPerPubdata: ctx.gasPerPubdata,
        refundRecipient: ctx.refundRecipient,
        l2Contract,
        l2Value,
      });

      // Optional fee overrides for simulate/write
      // viem client requires these to be explicitly set
      // Simulate to produce a writeContract-ready request
      // TODO: probably can remove l1GasQuote
      const sim = await wrapAs(
        'RPC',
        OP_DEPOSITS.eth.estGas,
        () =>
          ctx.client.l1.simulateContract({
            address: ctx.bridgehub,
            abi: IBridgehubABI,
            functionName: 'requestL2TransactionDirect',
            args: [req],
            value: mintValue,
            account: ctx.client.account,
          }),
        {
          ctx: { where: 'l1.simulateContract', to: ctx.bridgehub },
          message: 'Failed to simulate Bridgehub.requestL2TransactionDirect.',
        },
      );
      const data = encodeFunctionData({
        abi: sim.request.abi,
        functionName: sim.request.functionName,
        args: sim.request.args,
      });
      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data,
        value: mintValue,
        from: ctx.sender,
        ...ctx.gasOverrides,
      };
      const l1Gas = await quoteL1Gas({
        ctx,
        tx: l1TxCandidate,
        overrides: ctx.gasOverrides,
      });

      const steps: PlanStep<ViemPlanWriteRequest>[] = [
        {
          key: 'bridgehub:direct',
          kind: 'bridgehub:direct',
          description: 'Bridge ETH via Bridgehub.requestL2TransactionDirect',
          tx: { ...sim.request, ...l1Gas },
        },
      ];

      const fees = buildFeeBreakdown({
        feeToken: ETH_ADDRESS,
        l1Gas: l1Gas,
        l2Gas: l2GasParams,
        l2BaseCost: baseCost,
        operatorTip: ctx.operatorTip,
        mintValue,
      });

      return {
        steps,
        approvals: [],
        fees,
      };
    },
  };
}
