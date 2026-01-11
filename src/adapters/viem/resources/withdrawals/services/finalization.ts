// src/adapters/viem/resources/withdrawals/services/finalization.ts

import type { Address, Hex } from '../../../../../core/types/primitives';
import type { ViemClient } from '../../../client';
import {
  type FinalizeReadiness,
  type FinalizeDepositParams,
  type WithdrawalKey,
  type FinalizationEstimate,
} from '../../../../../core/types/flows/withdrawals';

import { IL1NullifierABI } from '../../../../../core/abi.ts';
import { L2_ASSET_ROUTER_ADDRESS, L1_MESSENGER_ADDRESS } from '../../../../../core/constants';
import { findL1MessageSentLog } from '../../../../../core/resources/withdrawals/events';
import { messengerLogIndex } from '../../../../../core/resources/withdrawals/logs';
import { createErrorHandlers } from '../../../errors/error-ops';
import { classifyReadinessFromRevert } from '../../../errors/revert';
import { OP_WITHDRAWALS } from '../../../../../core/types';
import { createError } from '../../../../../core/errors/factory';
import { toZKsyncError } from '../../../errors/error-ops';

import type { Abi, TransactionReceipt } from 'viem';
import { decodeAbiParameters } from 'viem';

// error handling
const { wrapAs } = createErrorHandlers('withdrawals');

// TODO: remove later
const IL1NullifierMini = [
  {
    type: 'function',
    name: 'isWithdrawalFinalized',
    stateMutability: 'view',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'l2BatchNumber', type: 'uint256' },
      { name: 'l2MessageIndex', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

export interface FinalizationServices {
  /**
   * Build finalizeDeposit params.
   */
  fetchFinalizeDepositParams(
    l2TxHash: Hex,
  ): Promise<{ params: FinalizeDepositParams; nullifier: Address }>;

  /**
   * Read the Nullifier mapping to check finalization status.
   */
  isWithdrawalFinalized(key: WithdrawalKey): Promise<boolean>;

  /**
   * Simulate finalizeDeposit on L1 Nullifier to check readiness.
   */
  simulateFinalizeReadiness(params: FinalizeDepositParams): Promise<FinalizeReadiness>;

  /**
   * Estimate gas & fees for finalizeDeposit on L1 Nullifier.
   */
  estimateFinalization(params: FinalizeDepositParams): Promise<FinalizationEstimate>;

  /**
   * Call finalizeDeposit on L1 Nullifier.
   */
  finalizeDeposit(
    params: FinalizeDepositParams,
  ): Promise<{ hash: string; wait: () => Promise<TransactionReceipt> }>;
}

export function createFinalizationServices(client: ViemClient): FinalizationServices {
  return {
    async fetchFinalizeDepositParams(l2TxHash: Hex) {
      // Fetch parsed L2 receipt (with L2->L1 logs)
      const parsed = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.fetchParams.receipt,
        () => client.zks.getReceiptWithL2ToL1(l2TxHash),
        {
          ctx: { where: 'getReceiptWithL2ToL1', l2TxHash },
          message: 'Failed to fetch L2 receipt (with L2→L1 logs).',
        },
      );
      if (!parsed) {
        throw createError('STATE', {
          resource: 'withdrawals',
          operation: OP_WITHDRAWALS.finalize.fetchParams.receipt,
          message: 'L2 receipt not found.',
          context: { l2TxHash },
        });
      }

      // Find L1MessageSent event and decode message bytes
      const ev = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.finalize.fetchParams.findMessage,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
        () => Promise.resolve(findL1MessageSentLog(parsed as any, { index: 0 })),
        {
          ctx: { l2TxHash, index: 0 },
          message: 'Failed to locate L1MessageSent event in L2 receipt.',
        },
      );

      const message = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.finalize.fetchParams.decodeMessage,
        () => {
          const [decoded] = decodeAbiParameters([{ type: 'bytes' }], ev.data);
          return decoded;
        },
        {
          ctx: { where: 'decode L1MessageSent', data: ev.data },
          message: 'Failed to decode withdrawal message.',
        },
      );

      // Fetch raw receipt again
      const raw = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.fetchParams.rawReceipt,
        () => client.zks.getReceiptWithL2ToL1(l2TxHash),
        {
          ctx: { where: 'getReceiptWithL2ToL1 (raw)', l2TxHash },
          message: 'Failed to fetch raw L2 receipt.',
        },
      );
      if (!raw) {
        throw createError('STATE', {
          resource: 'withdrawals',
          operation: OP_WITHDRAWALS.finalize.fetchParams.rawReceipt,
          message: 'Raw L2 receipt not found.',
          context: { l2TxHash },
        });
      }

      const idx = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.finalize.fetchParams.messengerIndex,
        () =>
          Promise.resolve(messengerLogIndex(raw, { index: 0, messenger: L1_MESSENGER_ADDRESS })),
        {
          ctx: { where: 'derive messenger log index', l2TxHash, receipt: raw },
          message: 'Failed to derive messenger log index.',
        },
      );

      // Fetch L2->L1 log proof
      const proof = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.fetchParams.proof,
        () => client.zks.getL2ToL1LogProof(l2TxHash, idx),
        {
          ctx: { where: 'get L2→L1 log proof', l2TxHash, messengerLogIndex: idx },
          message: 'Failed to fetch L2→L1 log proof.',
        },
      );

      const chainId = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.fetchParams.network,
        () => client.l2.getChainId(),
        { ctx: { where: 'l2.getChainId' }, message: 'Failed to read L2 chain id.' },
      );

      // TODO: fix me
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const txIndex = Number((parsed as any).transactionIndex ?? 0);

      const params: FinalizeDepositParams = {
        chainId: BigInt(chainId),
        l2BatchNumber: proof.batchNumber,
        l2MessageIndex: proof.id,
        l2Sender: L2_ASSET_ROUTER_ADDRESS,
        l2TxNumberInBatch: txIndex,
        message,
        merkleProof: proof.proof,
      };

      const { l1Nullifier } = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.finalize.fetchParams.ensureAddresses,
        () => client.ensureAddresses(),
        {
          ctx: { where: 'ensureAddresses' },
          message: 'Failed to ensure L1 Nullifier address.',
        },
      );

      return { params, nullifier: l1Nullifier };
    },

    async simulateFinalizeReadiness(params) {
      const { l1Nullifier } = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.finalize.readiness.ensureAddresses,
        () => client.ensureAddresses(),
        {
          ctx: { where: 'ensureAddresses' },
          message: 'Failed to ensure L1 Nullifier address.',
        },
      );

      // First, check if the withdrawal is already finalized
      const done = await (async () => {
        try {
          const result = await wrapAs(
            'RPC',
            OP_WITHDRAWALS.finalize.readiness.isFinalized,
            () =>
              client.l1.readContract({
                address: l1Nullifier,
                abi: IL1NullifierMini,
                functionName: 'isWithdrawalFinalized',
                args: [params.chainId, params.l2BatchNumber, params.l2MessageIndex],
              }),
            {
              ctx: { where: 'isWithdrawalFinalized', params },
              message: 'Failed to read finalization status.',
            },
          );

          return result;
        } catch {
          // If this read fails, treat as "not finalized" and fall through
          return false;
        }
      })();

      if (done) return { kind: 'FINALIZED' };

      // Try simulating finalizeDeposit on the same L1 Nullifier
      try {
        await client.l1.simulateContract({
          address: l1Nullifier,
          abi: IL1NullifierABI as Abi,
          functionName: 'finalizeDeposit',
          args: [params],
          account: client.account,
        });
        return { kind: 'READY' };
      } catch (e) {
        return classifyReadinessFromRevert(e);
      }
    },

    async isWithdrawalFinalized(key: WithdrawalKey) {
      const { l1Nullifier } = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.finalize.fetchParams.ensureAddresses,
        () => client.ensureAddresses(),
        {
          ctx: { where: 'ensureAddresses' },
          message: 'Failed to ensure L1 Nullifier address.',
        },
      );

      return await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.isFinalized,
        () =>
          client.l1.readContract({
            address: l1Nullifier,
            abi: IL1NullifierMini,
            functionName: 'isWithdrawalFinalized',
            args: [key.chainId, key.l2BatchNumber, key.l2MessageIndex],
          }),
        {
          ctx: { where: 'isWithdrawalFinalized', key },
          message: 'Failed to read finalization status.',
        },
      );
    },

    async estimateFinalization(params: FinalizeDepositParams): Promise<FinalizationEstimate> {
      const { l1Nullifier } = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.finalize.estimate,
        () => client.ensureAddresses(),
        {
          ctx: { where: 'ensureAddresses' },
          message: 'Failed to ensure L1 Nullifier address.',
        },
      );
      // Estimate gas for finalizeDeposit on the L1 Nullifier
      const gasLimit = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.estimate,
        () =>
          client.l1.estimateContractGas({
            address: l1Nullifier,
            abi: IL1NullifierABI as Abi,
            functionName: 'finalizeDeposit',
            args: [params],
            account: client.account,
          }),
        {
          ctx: {
            where: 'estimateContractGas(finalizeDeposit)',
            chainId: params.chainId,
            l2BatchNumber: params.l2BatchNumber,
            l2MessageIndex: params.l2MessageIndex,
            l1Nullifier,
          },
          message: 'Failed to estimate gas for finalizeDeposit.',
        },
      );

      // Estimate per-gas fees (with EIP-1559 + legacy fallback)
      let maxFeePerGas: bigint;
      let maxPriorityFeePerGas: bigint;

      try {
        const fee = await wrapAs(
          'RPC',
          OP_WITHDRAWALS.finalize.estimate,
          () => client.l1.estimateFeesPerGas(),
          {
            ctx: { where: 'estimateFeesPerGas' },
            message: 'Failed to estimate EIP-1559 fees.',
          },
        );

        maxFeePerGas =
          fee.maxFeePerGas ??
          (() => {
            throw createError('RPC', {
              resource: 'withdrawals',
              operation: OP_WITHDRAWALS.finalize.estimate,
              message: 'Provider did not return maxFeePerGas.',
              context: { fee },
            });
          })();
        maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? 0n;
      } catch {
        const gasPrice = await wrapAs(
          'RPC',
          OP_WITHDRAWALS.finalize.estimate,
          () => client.l1.getGasPrice(),
          {
            ctx: { where: 'getGasPrice' },
            message: 'Failed to read gas price for finalizeDeposit.',
          },
        );

        maxFeePerGas = gasPrice;
        maxPriorityFeePerGas = 0n;
      }

      return {
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };
    },

    async finalizeDeposit(params: FinalizeDepositParams) {
      const { l1Nullifier } = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.finalize.fetchParams.ensureAddresses,
        () => client.ensureAddresses(),
        {
          ctx: { where: 'ensureAddresses' },
          message: 'Failed to ensure L1 Nullifier address.',
        },
      );
      try {
        const hash = await client.l1Wallet.writeContract({
          address: l1Nullifier,
          abi: IL1NullifierABI as Abi,
          functionName: 'finalizeDeposit',
          args: [params],
          account: client.account,
        });

        return {
          hash,
          wait: async () => {
            try {
              return await client.l1.waitForTransactionReceipt({ hash });
            } catch (e) {
              throw toZKsyncError(
                'EXECUTION',
                {
                  resource: 'withdrawals',
                  operation: OP_WITHDRAWALS.finalize.wait,
                  message: 'Failed while waiting for finalizeDeposit transaction.',
                  context: { txHash: hash },
                },
                e,
              );
            }
          },
        };
      } catch (e) {
        throw toZKsyncError(
          'EXECUTION',
          {
            resource: 'withdrawals',
            operation: OP_WITHDRAWALS.finalize.send,
            message: 'Failed to send finalizeDeposit transaction.',
            context: {
              chainId: params.chainId,
              l2BatchNumber: params.l2BatchNumber,
              l2MessageIndex: params.l2MessageIndex,
              l1Nullifier,
            },
          },
          e,
        );
      }
    },
  };
}
