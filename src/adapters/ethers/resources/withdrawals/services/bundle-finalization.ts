import { Contract, type TransactionReceipt, type TransactionResponse } from 'ethers';
import type { EthersClient } from '../../../client';
import type { InteropFinalizationInfo } from '../../../../../core/types/flows/interop';
import type { FinalizeReadiness } from '../../../../../core/types/flows/withdrawals';
import type { FinalizationEstimate } from '../../../../../core/types/flows/withdrawals';
import type { Address, Hex } from '../../../../../core/types/primitives';
import { IL1InteropHandlerABI, IL1NullifierABI } from '../../../../../core/abi';
import {
  buildFinalizationInfo,
  decodeBundleStatus,
  parseBundleReceiptInfo,
  waitForBundleLifecycle,
  WITHDRAWAL_BUNDLE_LIFECYCLE_ERRORS,
  type BundleLifecycleState,
} from '../../../../../core/internal/cross-chain/bundle-lifecycle';
import { ProofTarget } from '../../../../../core/rpc/zks';
import { createError } from '../../../../../core/errors/factory';
import { isZKsyncError, OP_WITHDRAWALS } from '../../../../../core/types/errors';
import { createErrorHandlers, toZKsyncError } from '../../../errors/error-ops';
import { classifyReadinessFromRevert } from '../../../errors/revert';
import {
  decodeInteropBundleSent,
  decodeL1MessageData,
} from '../../interop/services/finalization/decoders';
import { getTopics } from '../../interop/services/finalization/topics';

const { wrapAs } = createErrorHandlers('withdrawals');

export interface WithdrawalBundleFinalizationServices {
  resolveHandler(): Promise<Address>;
  fetchBundleFinalizationInfo(l2TxHash: Hex): Promise<InteropFinalizationInfo>;
  waitForBundleFinalization(
    l2TxHash: Hex,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;
  readBundleState(bundleHash: Hex): Promise<BundleLifecycleState>;
  simulateExecuteBundle(info: InteropFinalizationInfo): Promise<FinalizeReadiness>;
  estimateExecuteBundle(info: InteropFinalizationInfo): Promise<FinalizationEstimate>;
  executeBundle(
    info: InteropFinalizationInfo,
  ): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }>;
}

function isProofNotReadyError(error: unknown): boolean {
  return isZKsyncError(error, {
    operation: 'zksrpc.getL2ToL1LogProof',
    messageIncludes: 'proof not yet available',
  });
}

export function createWithdrawalBundleFinalizationServices(
  client: EthersClient,
): WithdrawalBundleFinalizationServices {
  const { topics, centerIface } = getTopics();

  const getSourceReceipt = (l2TxHash: Hex) =>
    wrapAs(
      'RPC',
      OP_WITHDRAWALS.finalize.fetchParams.receipt,
      () => client.zks.getReceiptWithL2ToL1(l2TxHash),
      {
        ctx: { where: 'getReceiptWithL2ToL1', l2TxHash },
        message: 'Failed to fetch L2 receipt (with L2->L1 logs).',
      },
    );

  const resolveHandler = async (): Promise<Address> => {
    const { l1Nullifier } = await client.ensureAddresses();
    const nullifier = new Contract(l1Nullifier, IL1NullifierABI, client.l1);
    return wrapAs(
      'RPC',
      OP_WITHDRAWALS.finalize.isFinalized,
      async () => (await nullifier.l1InteropHandler()) as Address,
      {
        ctx: { where: 'IL1Nullifier.l1InteropHandler', l1Nullifier },
        message: 'Failed to resolve the L1 interop handler from IL1Nullifier.',
      },
    );
  };

  const parseReceipt = async (l2TxHash: Hex) => {
    const rawReceipt = await getSourceReceipt(l2TxHash);
    if (!rawReceipt) {
      throw createError('STATE', {
        resource: 'withdrawals',
        operation: OP_WITHDRAWALS.finalize.fetchParams.receipt,
        message: 'L2 receipt not found.',
        context: { l2TxHash },
      });
    }
    const { interopCenter } = await client.ensureAddresses();
    return parseBundleReceiptInfo({
      rawReceipt,
      interopCenter,
      interopBundleSentTopic: topics.interopBundleSent,
      decodeInteropBundleSent: (log) => decodeInteropBundleSent(centerIface, log),
      decodeL1MessageData,
      l2SrcTxHash: l2TxHash,
      errors: WITHDRAWAL_BUNDLE_LIFECYCLE_ERRORS,
    });
  };

  const fetchBundleFinalizationInfo = async (l2TxHash: Hex): Promise<InteropFinalizationInfo> => {
    const bundleInfo = await parseReceipt(l2TxHash);
    const proof = await wrapAs(
      'RPC',
      OP_WITHDRAWALS.finalize.fetchParams.proof,
      () =>
        client.zks.getL2ToL1LogProof(l2TxHash, bundleInfo.l2ToL1LogIndex, ProofTarget.MessageRoot),
      {
        ctx: { l2TxHash, messengerLogIndex: bundleInfo.l2ToL1LogIndex },
        message: 'Failed to fetch L2->L1 MessageRoot proof.',
      },
    );
    return buildFinalizationInfo(
      { l2SrcTxHash: l2TxHash },
      bundleInfo,
      proof,
      bundleInfo.l1MessageData,
      WITHDRAWAL_BUNDLE_LIFECYCLE_ERRORS,
    );
  };

  const readBundleState = async (bundleHash: Hex): Promise<BundleLifecycleState> => {
    const handlerAddress = await resolveHandler();
    const handler = new Contract(handlerAddress, IL1InteropHandlerABI, client.l1);
    const rawStatus = await wrapAs(
      'RPC',
      OP_WITHDRAWALS.finalize.isFinalized,
      async () => BigInt(await handler.bundleStatus(bundleHash)),
      {
        ctx: { where: 'L1InteropHandler.bundleStatus', handlerAddress, bundleHash },
        message: 'Failed to read L1 withdrawal bundle status.',
      },
    );
    return decodeBundleStatus(rawStatus, WITHDRAWAL_BUNDLE_LIFECYCLE_ERRORS);
  };

  return {
    resolveHandler,
    fetchBundleFinalizationInfo,

    async waitForBundleFinalization(l2TxHash, opts) {
      const { interopCenter } = await client.ensureAddresses();
      return waitForBundleLifecycle({
        sourceTxHash: l2TxHash,
        options: opts,
        errors: WITHDRAWAL_BUNDLE_LIFECYCLE_ERRORS,
        getSourceReceipt,
        parseReceipt: (rawReceipt) =>
          parseBundleReceiptInfo({
            rawReceipt,
            interopCenter,
            interopBundleSentTopic: topics.interopBundleSent,
            decodeInteropBundleSent: (log) => decodeInteropBundleSent(centerIface, log),
            decodeL1MessageData,
            l2SrcTxHash: l2TxHash,
            errors: WITHDRAWAL_BUNDLE_LIFECYCLE_ERRORS,
          }),
        getFinalizedBlockNumber: async () => {
          const block = await client.l2.getBlock('finalized');
          return block ? BigInt(block.number) : null;
        },
        getProof: (txHash, logIndex) =>
          client.zks.getL2ToL1LogProof(txHash, logIndex, ProofTarget.MessageRoot),
        isProofNotReadyError,
      });
    },

    readBundleState,

    async simulateExecuteBundle(info) {
      const state = await readBundleState(info.bundleHash);
      if (state === 'FULLY_EXECUTED') return { kind: 'FINALIZED' };
      if (state === 'UNBUNDLED') {
        return {
          kind: 'UNFINALIZABLE',
          reason: 'message-invalid',
          detail: 'Withdrawal bundle was unbundled.',
        };
      }

      const handlerAddress = await resolveHandler();
      const handler = new Contract(handlerAddress, IL1InteropHandlerABI, client.l1);
      try {
        await handler.executeBundle.staticCall(info.encodedData, info.proof);
        return { kind: 'READY' };
      } catch (error) {
        return classifyReadinessFromRevert(error);
      }
    },

    async estimateExecuteBundle(info) {
      const handlerAddress = await resolveHandler();
      const handler = new Contract(handlerAddress, IL1InteropHandlerABI, client.getL1Signer());
      const gasLimit = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.estimate,
        () => handler.executeBundle.estimateGas(info.encodedData, info.proof),
        {
          ctx: { where: 'estimateGas(executeBundle)', handlerAddress, bundleHash: info.bundleHash },
          message: 'Failed to estimate gas for L1InteropHandler.executeBundle.',
        },
      );
      const feeData = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.estimate,
        () => client.l1.getFeeData(),
        {
          ctx: { where: 'l1.getFeeData' },
          message: 'Failed to estimate fee data for executeBundle.',
        },
      );
      const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
      if (maxFeePerGas == null) {
        throw createError('RPC', {
          resource: 'withdrawals',
          operation: OP_WITHDRAWALS.finalize.estimate,
          message: 'Provider did not return gas price or EIP-1559 fields.',
          context: { feeData },
        });
      }
      return {
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
      };
    },

    async executeBundle(info) {
      const handlerAddress = await resolveHandler();
      const handler = new Contract(handlerAddress, IL1InteropHandlerABI, client.getL1Signer());
      try {
        const response = (await handler.executeBundle(
          info.encodedData,
          info.proof,
        )) as TransactionResponse;
        const hash = response.hash as Hex;
        return {
          hash,
          wait: async () => {
            try {
              const receipt = await response.wait();
              if (!receipt || receipt.status !== 1) {
                throw createError('EXECUTION', {
                  resource: 'withdrawals',
                  operation: OP_WITHDRAWALS.finalize.wait,
                  message: 'Withdrawal executeBundle transaction reverted on L1.',
                  context: { txHash: hash, bundleHash: info.bundleHash },
                });
              }
              return receipt;
            } catch (error) {
              if (isZKsyncError(error)) throw error;
              throw toZKsyncError(
                'EXECUTION',
                {
                  resource: 'withdrawals',
                  operation: OP_WITHDRAWALS.finalize.wait,
                  message: 'Failed while waiting for executeBundle transaction.',
                  context: { txHash: hash, bundleHash: info.bundleHash },
                },
                error,
              );
            }
          },
        };
      } catch (error) {
        if (isZKsyncError(error)) throw error;
        throw toZKsyncError(
          'EXECUTION',
          {
            resource: 'withdrawals',
            operation: OP_WITHDRAWALS.finalize.send,
            message: 'Failed to send L1InteropHandler.executeBundle transaction.',
            context: { handlerAddress, bundleHash: info.bundleHash },
          },
          error,
        );
      }
    },
  };
}
