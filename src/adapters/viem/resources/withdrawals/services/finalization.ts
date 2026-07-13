import type { TransactionReceipt } from 'viem';
import type { ViemClient } from '../../../client';
import type { BundleFinalizationInfo } from '../../../../../core/internal/cross-chain/types';
import type {
  FinalizationEstimate,
  FinalizeDepositParams,
  FinalizeReadiness,
  WithdrawalKey,
} from '../../../../../core/types/flows/withdrawals';
import type { Address, Hex } from '../../../../../core/types/primitives';
import { createError } from '../../../../../core/errors/factory';
import { OP_WITHDRAWALS } from '../../../../../core/types/errors';
import {
  getBundleEncodedData,
  WITHDRAWAL_BUNDLE_LIFECYCLE_ERRORS,
} from '../../../../../core/internal/cross-chain/bundle-lifecycle';
import { createWithdrawalBundleFinalizationServices } from './bundle-finalization';

const ZERO_TX_HASH: Hex = `0x${'00'.repeat(32)}`;

/** @deprecated Use `sdk.withdrawals.status`, `wait`, and `finalize` instead. */
export interface FinalizationServices {
  fetchFinalizeDepositParams(
    l2TxHash: Hex,
  ): Promise<{ params: FinalizeDepositParams; nullifier: Address }>;
  isWithdrawalFinalized(key: WithdrawalKey): Promise<boolean>;
  simulateFinalizeReadiness(params: FinalizeDepositParams): Promise<FinalizeReadiness>;
  estimateFinalization(params: FinalizeDepositParams): Promise<FinalizationEstimate>;
  finalizeDeposit(
    params: FinalizeDepositParams,
  ): Promise<{ hash: string; wait: () => Promise<TransactionReceipt> }>;
}

function requireBundleHash(input: { bundleHash?: Hex }, operation: string): Hex {
  if (input.bundleHash) return input.bundleHash;
  throw createError('STATE', {
    resource: 'withdrawal-finalization',
    operation,
    message:
      'Deprecated withdrawal finalization input is missing bundleHash. Use sdk.withdrawals.finalize(l2TxHash) or fetch fresh finalization params first.',
    context: { migration: 'sdk.withdrawals.finalize' },
  });
}

async function toBundleInfo(
  client: ViemClient,
  params: FinalizeDepositParams,
): Promise<BundleFinalizationInfo> {
  const bundleHash = requireBundleHash(params, OP_WITHDRAWALS.finalize.readiness.simulate);
  return {
    l2SrcTxHash: ZERO_TX_HASH,
    bundleHash,
    dstChainId: BigInt(await client.l1.getChainId()),
    encodedData: getBundleEncodedData(params.message, WITHDRAWAL_BUNDLE_LIFECYCLE_ERRORS),
    proof: {
      chainId: params.chainId,
      l1BatchNumber: params.l2BatchNumber,
      l2MessageIndex: params.l2MessageIndex,
      message: {
        txNumberInBatch: params.l2TxNumberInBatch,
        sender: params.l2Sender,
        data: params.message,
      },
      proof: params.merkleProof,
    },
  };
}

/**
 * @deprecated Use `sdk.withdrawals.status`, `wait`, and `finalize`. This wrapper is
 * retained for one minor release and delegates to `L1InteropHandler.executeBundle`.
 */
export function createFinalizationServices(client: ViemClient): FinalizationServices {
  const bundle = createWithdrawalBundleFinalizationServices(client);
  return {
    async fetchFinalizeDepositParams(l2TxHash) {
      const info = await bundle.fetchBundleFinalizationInfo(l2TxHash);
      const { l1Nullifier } = await client.ensureAddresses();
      return {
        nullifier: l1Nullifier,
        params: {
          bundleHash: info.bundleHash,
          chainId: info.proof.chainId,
          l2BatchNumber: info.proof.l1BatchNumber,
          l2MessageIndex: info.proof.l2MessageIndex,
          l2Sender: info.proof.message.sender,
          l2TxNumberInBatch: info.proof.message.txNumberInBatch,
          message: info.proof.message.data,
          merkleProof: info.proof.proof,
        },
      };
    },

    async isWithdrawalFinalized(key) {
      const bundleHash = requireBundleHash(key, OP_WITHDRAWALS.finalize.isFinalized);
      return (await bundle.readBundleState(bundleHash)) === 'FULLY_EXECUTED';
    },

    async simulateFinalizeReadiness(params) {
      return bundle.simulateExecuteBundle(await toBundleInfo(client, params));
    },

    async estimateFinalization(params) {
      return bundle.estimateExecuteBundle(await toBundleInfo(client, params));
    },

    async finalizeDeposit(params) {
      return bundle.executeBundle(await toBundleInfo(client, params));
    },
  };
}
