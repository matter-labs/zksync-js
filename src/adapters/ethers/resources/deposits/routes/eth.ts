// src/adapters/ethers/resources/deposits/routes/eth.ts

import { AbiCoder, type TransactionRequest } from 'ethers';
import type { DepositRouteStrategy } from './types';
import { buildDirectRequestStruct } from '../../utils';
import type { PlanStep } from '../../../../../core/types/flows/base';
import type { Address } from '../../../../../core/types/primitives';
import { ETH_ADDRESS } from '../../../../../core/constants.ts';
import { quoteL2BaseCost } from '../services/fee.ts';
import { quoteL1Gas, quoteL2Gas } from '../services/gas.ts';
import { buildFeeBreakdown } from '../../../../../core/resources/deposits/fee.ts';
import { deriveDirectPriorityTxGasBreakdown } from '../../../../../core/resources/deposits/priority.ts';
const EMPTY_BYTES = '0x';
const ZERO_RESERVED_WORDS = [0n, 0n, 0n, 0n] as const;
const L2_CANONICAL_TRANSACTION_TUPLE =
  'tuple(uint256 txType,uint256 from,uint256 to,uint256 gasLimit,uint256 gasPerPubdataByteLimit,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 paymaster,uint256 nonce,uint256 value,uint256[4] reserved,bytes data,bytes signature,uint256[] factoryDeps,bytes paymasterInput,bytes reservedDynamic)';

function hexByteLength(hex: string): bigint {
  return BigInt(Math.max(hex.length - 2, 0) / 2);
}

// Mailbox validates the direct priority request using `abi.encode(transaction)`, so the
// quote path mirrors that exact tuple shape instead of approximating a fixed encoded size.
function getDirectPriorityTxEncodedLength(input: {
  sender: Address;
  l2Contract: Address;
  l2Value: bigint;
  l2Calldata: `0x${string}`;
  gasPerPubdata: bigint;
}): bigint {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    [L2_CANONICAL_TRANSACTION_TUPLE],
    [
      [
        0n,
        BigInt(input.sender),
        BigInt(input.l2Contract),
        0n,
        input.gasPerPubdata,
        0n,
        0n,
        0n,
        0n,
        input.l2Value,
        ZERO_RESERVED_WORDS,
        input.l2Calldata,
        EMPTY_BYTES,
        [],
        EMPTY_BYTES,
        EMPTY_BYTES,
      ],
    ],
  );

  return hexByteLength(encoded);
}

// ETH deposit route via Bridgehub.requestL2TransactionDirect
// ETH is base token
export function routeEthDirect(): DepositRouteStrategy {
  return {
    async build(p, ctx) {
      const bh = await ctx.contracts.bridgehub();
      const l2Contract = p.to ?? ctx.sender;
      const l2Value = p.amount;
      const l2Calldata = EMPTY_BYTES as `0x${string}`;

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

      const data = bh.interface.encodeFunctionData('requestL2TransactionDirect', [req]);

      // TX for estimating L1 gas
      const l1TxCandidate: TransactionRequest = {
        to: ctx.bridgehub,
        data,
        value: mintValue,
        from: ctx.sender,
        ...ctx.gasOverrides,
      };
      const l1GasParams = await quoteL1Gas({
        ctx,
        tx: l1TxCandidate,
        overrides: ctx.gasOverrides,
      });
      if (l1GasParams) {
        l1TxCandidate.gasLimit = l1GasParams.gasLimit;
        l1TxCandidate.maxFeePerGas = l1GasParams.maxFeePerGas;
        l1TxCandidate.maxPriorityFeePerGas = l1GasParams.maxPriorityFeePerGas;
      }

      const steps: PlanStep<TransactionRequest>[] = [
        {
          key: 'bridgehub:direct',
          kind: 'bridgehub:direct',
          description: 'Bridge ETH via Bridgehub.requestL2TransactionDirect',
          tx: l1TxCandidate,
        },
      ];

      const fees = buildFeeBreakdown({
        feeToken: ETH_ADDRESS,
        l1Gas: l1GasParams,
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
