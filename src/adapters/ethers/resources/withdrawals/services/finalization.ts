// src/adapters/ethers/resources/withdrawals/services/finalization.ts

import { AbiCoder, Contract, type TransactionReceipt } from 'ethers';

import type { Address, Hex } from '../../../../../core/types/primitives';
import type { EthersClient } from '../../../client';
import {
  type FinalizeReadiness,
  type FinalizeDepositParams,
  type WithdrawalKey,
  type FinalizationEstimate,
} from '../../../../../core/types/flows/withdrawals';

import { IL1NullifierABI } from '../../../../../core/abi.ts';

import { L2_ASSET_ROUTER_ADDRESS, L1_MESSENGER_ADDRESS } from '../../../../../core/constants';
import { findL1MessageSentLog } from '../../../../../core/utils/events';
import { messengerLogIndex } from '../../../../../core/resources/withdrawals/logs';
import { createErrorHandlers } from '../../../errors/error-ops';
import { classifyReadinessFromRevert } from '../../../errors/revert';
import { OP_WITHDRAWALS } from '../../../../../core/types';
import { createError } from '../../../../../core/errors/factory';
import { toZKsyncError } from '../../../errors/error-ops';

// error handling
const { wrapAs } = createErrorHandlers('withdrawals');

// TODO: remove later
const IL1NullifierMini = [
  'function isWithdrawalFinalized(uint256,uint256,uint256) view returns (bool)',
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

export function createFinalizationServices(client: EthersClient): FinalizationServices {
  const { l1, l2, signer } = client;

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
        () => Promise.resolve(AbiCoder.defaultAbiCoder().decode(['bytes'], ev.data)[0] as Hex),
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

      const { chainId } = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.fetchParams.network,
        () => l2.getNetwork(),
        {
          ctx: { where: 'l2.getNetwork' },
          message: 'Failed to read L2 network.',
        },
      );

      const txIndex = Number(parsed.transactionIndex);
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

    async simulateFinalizeReadiness(params: FinalizeDepositParams): Promise<FinalizeReadiness> {
      const { l1Nullifier } = await wrapAs(
        'INTERNAL',
        OP_WITHDRAWALS.finalize.readiness.ensureAddresses,
        () => client.ensureAddresses(),
        {
          ctx: { where: 'ensureAddresses' },
          message: 'Failed to ensure L1 Nullifier address.',
        },
      );

      // check if the withdrawal is already finalized
      const done = await (async (): Promise<boolean> => {
        try {
          const cMini = new Contract(l1Nullifier, IL1NullifierMini, l1);
          const isFinalized = await wrapAs(
            'RPC',
            OP_WITHDRAWALS.finalize.readiness.isFinalized,
            (): Promise<boolean> =>
              cMini.isWithdrawalFinalized(
                params.chainId,
                params.l2BatchNumber,
                params.l2MessageIndex,
              ),
            {
              ctx: { where: 'isWithdrawalFinalized', params },
              message: 'Failed to read finalization status.',
            },
          );

          return Boolean(isFinalized);
        } catch {
          // If this read fails for any reason, treat as "not finalized" and fall through
          return false;
        }
      })();

      if (done) return { kind: 'FINALIZED' };

      // Try simulating finalizeDeposit
      const c = new Contract(l1Nullifier, IL1NullifierABI, l1);
      try {
        await c.finalizeDeposit.staticCall(params);
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
      const c = new Contract(l1Nullifier, IL1NullifierMini, l1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.isFinalized,
        () => c.isWithdrawalFinalized(key.chainId, key.l2BatchNumber, key.l2MessageIndex),
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

      const signer = client.getL1Signer();
      const c = new Contract(l1Nullifier, IL1NullifierABI, signer);

      // Estimate gas for finalizeDeposit on the L1 Nullifier
      const gasLimit = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.estimate,
        () => c.finalizeDeposit.estimateGas(params),
        {
          ctx: {
            where: 'estimateGas(finalizeDeposit)',
            chainId: params.chainId,
            l2BatchNumber: params.l2BatchNumber,
            l2MessageIndex: params.l2MessageIndex,
            l1Nullifier,
          },
          message: 'Failed to estimate gas for finalizeDeposit.',
        },
      );

      // Estimate per-gas fees (EIP-1559 if available, fallback to legacy gasPrice)
      const feeData = await wrapAs('RPC', OP_WITHDRAWALS.finalize.estimate, () => l1.getFeeData(), {
        ctx: { where: 'l1.getFeeData' },
        message: 'Failed to estimate fee data for finalizeDeposit.',
      });

      const maxFeePerGas =
        feeData.maxFeePerGas ??
        feeData.gasPrice ?? // legacy-style gas price if present
        (() => {
          throw createError('RPC', {
            resource: 'withdrawals',
            operation: OP_WITHDRAWALS.finalize.estimate,
            message: 'Provider did not return gas price or EIP-1559 fields.',
            context: { feeData },
          });
        })();

      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;

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
      const c = new Contract(l1Nullifier, IL1NullifierABI, signer);
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const receipt = await c.finalizeDeposit(params);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const hash = receipt.hash;

        return {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          hash,
          wait: async () => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
              return await receipt.wait();
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
        // Map send failures to EXECUTION; revert data is decoded by toZKsyncError
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
