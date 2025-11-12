// src/adapters/ethers/resources/withdrawals/routes/eth-nonbase.ts
import { Interface, type TransactionRequest } from 'ethers';
import type { WithdrawRouteStrategy } from './types';
import type { PlanStep } from '../../../../../core/types/flows/base';
import { L2_BASE_TOKEN_ADDRESS } from '../../../../../core/constants';
import { IBaseTokenABI } from '../../../../../core/internal/abi-registry.ts';
import { createErrorHandlers } from '../../../errors/error-ops';
import { OP_WITHDRAWALS } from '../../../../../core/types';

const { wrapAs } = createErrorHandlers('withdrawals');

// Withdraw the chain's base token on a non-ETH-based chain.
export function routeEthNonBase(): WithdrawRouteStrategy {
  return {
    async preflight(p, ctx) {
      await wrapAs(
        'VALIDATION',
        OP_WITHDRAWALS.ethNonBase.assertNonEthBase,
        () => {
          if (p.token.toLowerCase() !== L2_BASE_TOKEN_ADDRESS.toLowerCase()) {
            throw new Error('eth-nonbase route requires the L2 base-token alias (0x…800A).');
          }
          if (ctx.baseIsEth) {
            throw new Error('eth-nonbase route requires chain base ≠ ETH.');
          }
        },
        { ctx: { token: p.token, baseIsEth: ctx.baseIsEth } },
      );
    },

    async build(p, ctx) {
      const steps: Array<PlanStep<TransactionRequest>> = [];
      const { gasLimit: overrideGasLimit, maxFeePerGas, maxPriorityFeePerGas } = ctx.fee;

      const toL1 = p.to ?? ctx.sender;
      const iface = new Interface(IBaseTokenABI);
      const data = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.eth.encodeWithdraw, // reuse label for base-token system call
        () => Promise.resolve(iface.encodeFunctionData('withdraw', [toL1])),
        { ctx: { where: 'L2BaseToken.withdraw', to: toL1 } },
      );

      const tx: TransactionRequest = {
        to: L2_BASE_TOKEN_ADDRESS,
        data,
        from: ctx.sender,
        value: p.amount,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };

      // TODO: consider a more robust buffer strategy
      // best-effort gas estimate
      if (overrideGasLimit != null) {
        tx.gasLimit = overrideGasLimit;
      } else {
        try {
          const est = await wrapAs(
            'RPC',
            OP_WITHDRAWALS.eth.estGas,
            () => ctx.client.l2.estimateGas(tx),
            {
              ctx: { where: 'l2.estimateGas', to: L2_BASE_TOKEN_ADDRESS },
              message: 'Failed to estimate gas for L2 base-token withdraw.',
            },
          );
          tx.gasLimit = (BigInt(est) * 115n) / 100n;
        } catch {
          // ignore
        }
      }

      steps.push({
        key: 'l2-base-token:withdraw',
        kind: 'l2-base-token:withdraw',
        description: 'Withdraw base token via L2 Base Token System (base ≠ ETH)',
        tx,
      });

      return { steps, approvals: [], quoteExtras: {} };
    },
  };
}
