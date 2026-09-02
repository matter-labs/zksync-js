// src/adapters/ethers/resources/withdrawals/services/finalization.ts
//
// Withdrawal finalization on L1, for both withdrawal protocols.
//
//   v31 (`legacy-withdrawal`) L1Nullifier.finalizeDeposit(FinalizeL1DepositParams)
//                             status via L1Nullifier.isWithdrawalFinalized(chainId, batch, index)
//
//   v32 (`interop-bundle`)    L1InteropHandler.executeBundle(bundle, MessageInclusionProof)
//                             status via L1InteropHandler.bundleStatus(bundleHash)
//
// v32 removed `finalizeDeposit`, `finalizeWithdrawal` and `isWithdrawalFinalized` from the
// nullifier outright, so there is no shared entry point to fall back on — everything here branches
// on the detected protocol.

import {
  AbiCoder,
  Contract,
  type ContractTransactionResponse,
  type TransactionReceipt,
} from 'ethers';

import type { Address, Hex } from '../../../../../core/types/primitives';
import type { EthersClient } from '../../../client';
import {
  type FinalizeReadiness,
  type FinalizeDepositParams,
  type FinalizationEstimate,
  type WithdrawalFinalization,
  type ResolvedWithdrawalFinalization,
} from '../../../../../core/types/flows/withdrawals';

import {
  IL1NullifierABI,
  IL1NullifierV32ABI,
  IInteropHandlerABI,
} from '../../../../../core/abi.ts';

import { L1_MESSENGER_ADDRESS } from '../../../../../core/constants';
import { findL1MessageSentLog, l1MessageSentSender } from '../../../../../core/utils/events';
import { messengerLogIndex } from '../../../../../core/resources/withdrawals/logs';
import type { CallStatus } from '../../../../../core/resources/withdrawals/finalization';
import {
  buildWithdrawalFinalization,
  classifyWithdrawalOutcome,
  parseBundleHashFromLogs,
  BundleStatus,
  type WithdrawalOutcome,
} from '../../../../../core/resources/withdrawals/finalization';
import { createErrorHandlers } from '../../../errors/error-ops';
import { classifyReadinessFromRevert } from '../../../errors/revert';
import { OP_WITHDRAWALS } from '../../../../../core/types';
import { createError } from '../../../../../core/errors/factory';
import { toZKsyncError } from '../../../errors/error-ops';
import { createWithdrawalProtocolService, type WithdrawalProtocolService } from './protocol';

// error handling
const { wrapAs } = createErrorHandlers('withdrawals');

// TODO: remove later
const IL1NullifierMini = [
  'function isWithdrawalFinalized(uint256,uint256,uint256) view returns (bool)',
] as const;

export interface FinalizationServices {
  /**
   * Derive the finalization arguments for a withdrawal, tagged with the protocol they belong to.
   */
  fetchFinalization(l2TxHash: Hex): Promise<ResolvedWithdrawalFinalization>;

  /**
   * Build `finalizeDeposit` params.
   *
   * @deprecated Only meaningful on protocol v31 chains. Throws on v32+, where withdrawals are
   * finalized through the interop handler — use {@link fetchFinalization} instead.
   */
  fetchFinalizeDepositParams(
    l2TxHash: Hex,
  ): Promise<{ params: FinalizeDepositParams; nullifier: Address }>;

  /** Check whether the withdrawal has already been finalized on L1. */
  isWithdrawalFinalized(finalization: WithdrawalFinalization): Promise<boolean>;

  /**
   * Classify the withdrawal's on-chain outcome, on either protocol: read from
   * `L1Nullifier.isWithdrawalFinalized` on `legacy-withdrawal`, and from the interop handler's
   * bundle/call status on `interop-bundle`.
   *
   * Distinguishes a terminally-failed withdrawal (v32 only: the bundle was unwound with its call
   * cancelled) from one that is merely not finalized yet — which {@link isWithdrawalFinalized}
   * collapses into `false`. `failed` is unreachable on the legacy protocol, which has no equivalent
   * of an unbundle.
   */
  withdrawalOutcome(finalization: WithdrawalFinalization): Promise<WithdrawalOutcome>;

  /** Simulate finalization on L1 to check readiness. */
  simulateFinalizeReadiness(finalization: WithdrawalFinalization): Promise<FinalizeReadiness>;

  /** Estimate gas & fees for finalization on L1. */
  estimateFinalization(finalization: WithdrawalFinalization): Promise<FinalizationEstimate>;

  /** Send the finalization transaction on L1. */
  finalize(
    finalization: WithdrawalFinalization,
  ): Promise<{ hash: string; wait: () => Promise<TransactionReceipt> }>;
}

export function createFinalizationServices(
  client: EthersClient,
  /**
   * Withdrawal-protocol detection. Optional: constructed per client when omitted, so
   * `createFinalizationServices(client)` keeps working. Pass one in to share the detection cache
   * with a withdrawals resource built over the same client.
   */
  protocolService: WithdrawalProtocolService = createWithdrawalProtocolService(client),
): FinalizationServices {
  const { l1, l2, signer } = client;

  /** The L1 contract that finalizes withdrawals under the given protocol. */
  async function finalizationTarget(
    protocol: WithdrawalFinalization['protocol'],
  ): Promise<Address> {
    const { l1Nullifier } = await client.ensureAddresses();
    if (protocol === 'legacy-withdrawal') return l1Nullifier;

    // The nullifier is the stable, already-resolved anchor, and it points at the handler that took
    // over its finalization duties — so the handler needs no extra configuration.
    const nullifier = new Contract(l1Nullifier, IL1NullifierV32ABI, l1);
    const handler = await wrapAs(
      'CONTRACT',
      OP_WITHDRAWALS.finalize.fetchParams.receipt,
      () => nullifier.l1InteropHandler() as Promise<Address>,
      {
        ctx: { where: 'L1Nullifier.l1InteropHandler', l1Nullifier },
        message:
          'Failed to resolve the L1 interop handler. The chain reports protocol v32+, but its ' +
          'L1Nullifier does not expose `l1InteropHandler()`.',
      },
    );

    return handler;
  }

  /** Shared receipt/proof plumbing: both protocols need the message, its log index and a proof. */
  async function fetchMessageAndProof(l2TxHash: Hex) {
    const raw = await wrapAs(
      'RPC',
      OP_WITHDRAWALS.finalize.fetchParams.receipt,
      () => client.zks.getReceiptWithL2ToL1(l2TxHash),
      {
        ctx: { where: 'getReceiptWithL2ToL1', l2TxHash },
        message: 'Failed to fetch L2 receipt (with L2→L1 logs).',
      },
    );
    if (!raw) {
      throw createError('STATE', {
        resource: 'withdrawals',
        operation: OP_WITHDRAWALS.finalize.fetchParams.receipt,
        message: 'L2 receipt not found.',
        context: { l2TxHash },
      });
    }

    const ev = await wrapAs(
      'INTERNAL',
      OP_WITHDRAWALS.finalize.fetchParams.findMessage,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      () => Promise.resolve(findL1MessageSentLog(raw as any, { index: 0 })),
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

    const idx = await wrapAs(
      'INTERNAL',
      OP_WITHDRAWALS.finalize.fetchParams.messengerIndex,
      () => Promise.resolve(messengerLogIndex(raw, { index: 0, messenger: L1_MESSENGER_ADDRESS })),
      {
        ctx: { where: 'derive messenger log index', l2TxHash, receipt: raw },
        message: 'Failed to derive messenger log index.',
      },
    );

    // Default proof target (`l1BatchRoot`) is the right one for both protocols: the proof is
    // verified on L1, so it must cover the full gateway batch range including the local-root
    // extension. (Interop L2→L2 finalization is what needs `messageRoot` instead.)
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
      { ctx: { where: 'l2.getNetwork' }, message: 'Failed to read L2 network.' },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const txNumberInBatch = Number((raw as any).transactionIndex ?? 0);

    // The v31 nullifier requires `l2Sender` to be the contract that *emitted* the message (the base
    // token system contract or the asset router), not the transaction's `to`. Those coincide only
    // when the user calls the system contract directly; a withdrawal routed through another
    // contract would otherwise revert with `WrongL2Sender`. `_sender` is the first indexed
    // parameter of `L1MessageSent`.
    const l2Sender = l1MessageSentSender(ev);

    return { raw, message, proof, chainId: BigInt(chainId), txNumberInBatch, l2Sender };
  }

  async function fetchFinalization(l2TxHash: Hex): Promise<ResolvedWithdrawalFinalization> {
    const protocol = await protocolService.protocol();
    const { raw, message, proof, chainId, txNumberInBatch, l2Sender } =
      await fetchMessageAndProof(l2TxHash);
    const target = await finalizationTarget(protocol);

    if (protocol === 'legacy-withdrawal') {
      const params: FinalizeDepositParams = {
        chainId,
        l2BatchNumber: proof.batchNumber,
        l2MessageIndex: proof.id,
        l2Sender,
        l2TxNumberInBatch: txNumberInBatch,
        message,
        merkleProof: proof.proof,
      };

      return {
        target,
        finalization: { protocol, params },
        key: {
          chainIdL2: chainId,
          l2BatchNumber: proof.batchNumber,
          l2MessageIndex: proof.id,
        },
      };
    }

    // Resolved, not canonical: a client may override it, and the L1 handler checks the sender.
    const { interopCenter } = await client.ensureAddresses();
    const params = buildWithdrawalFinalization({
      messageData: message,
      sourceChainId: chainId,
      txNumberInBatch,
      proof: { batchNumber: proof.batchNumber, id: proof.id, proof: proof.proof },
      // Prefer the hash the InteropCenter emitted over recomputing it.
      bundleHash: parseBundleHashFromLogs(raw.logs ?? [], interopCenter),
      interopCenter,
    });

    return {
      target,
      finalization: { protocol, params },
      key: {
        chainIdL2: chainId,
        l2BatchNumber: proof.batchNumber,
        l2MessageIndex: proof.id,
        bundleHash: params.bundleHash,
      },
    };
  }

  async function withdrawalOutcome(
    finalization: WithdrawalFinalization,
  ): Promise<WithdrawalOutcome> {
    const target = await finalizationTarget(finalization.protocol);

    // Pre-v32: the nullifier's boolean is the whole answer — there is no unbundle to fail.
    if (finalization.protocol === 'legacy-withdrawal') {
      const c = new Contract(target, IL1NullifierMini, l1);
      const done = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.isFinalized,
        () =>
          c.isWithdrawalFinalized(
            finalization.params.chainId,
            finalization.params.l2BatchNumber,
            finalization.params.l2MessageIndex,
          ) as Promise<boolean>,
        {
          ctx: { where: 'isWithdrawalFinalized', params: finalization.params },
          message: 'Failed to read finalization status.',
        },
      );
      return done ? 'finalized' : 'pending';
    }

    const { bundleHash } = finalization.params;
    const handler = new Contract(target, IInteropHandlerABI, l1);
    const status = Number(
      await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.isFinalized,
        () => handler.bundleStatus(bundleHash) as Promise<bigint>,
        {
          ctx: { where: 'L1InteropHandler.bundleStatus', bundleHash },
          message: 'Failed to read bundle status.',
        },
      ),
    ) as BundleStatus;

    // Only `Unbundled` needs the per-call status: the unbundler may have cancelled the withdrawal's
    // call rather than executing it, in which case nothing was paid out.
    if (status !== BundleStatus.Unbundled) return classifyWithdrawalOutcome(status);

    const callStatus = Number(
      await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.isFinalized,
        () => handler.callStatus(bundleHash, 0) as Promise<bigint>,
        {
          ctx: { where: 'L1InteropHandler.callStatus', bundleHash },
          message: 'Failed to read bundle call status.',
        },
      ),
    ) as CallStatus;

    return classifyWithdrawalOutcome(status, callStatus);
  }

  async function isWithdrawalFinalized(finalization: WithdrawalFinalization): Promise<boolean> {
    return (await withdrawalOutcome(finalization)) === 'finalized';
  }

  return {
    fetchFinalization,
    isWithdrawalFinalized,
    withdrawalOutcome,

    async fetchFinalizeDepositParams(l2TxHash: Hex) {
      const resolved = await fetchFinalization(l2TxHash);
      if (resolved.finalization.protocol !== 'legacy-withdrawal') {
        throw createError('VALIDATION', {
          resource: 'withdrawals',
          operation: OP_WITHDRAWALS.finalize.fetchParams.receipt,
          message:
            'This chain finalizes withdrawals through the L1 interop handler; ' +
            '`finalizeDeposit` params do not exist. Use `fetchFinalization` instead.',
          context: { l2TxHash, protocol: resolved.finalization.protocol },
        });
      }
      return { params: resolved.finalization.params, nullifier: resolved.target };
    },

    async simulateFinalizeReadiness(
      finalization: WithdrawalFinalization,
    ): Promise<FinalizeReadiness> {
      const target = await finalizationTarget(finalization.protocol);

      // Cheap authoritative check first; a revert here is non-fatal, we fall through to simulation.
      const done = await (async () => {
        try {
          return await isWithdrawalFinalized(finalization);
        } catch {
          return false;
        }
      })();
      if (done) return { kind: 'FINALIZED' };

      try {
        if (finalization.protocol === 'legacy-withdrawal') {
          const c = new Contract(target, IL1NullifierABI, l1);
          await c.finalizeDeposit.staticCall(finalization.params);
        } else {
          const handler = new Contract(target, IInteropHandlerABI, l1);
          await handler.executeBundle.staticCall(
            finalization.params.bundle,
            finalization.params.proof,
          );
        }
        return { kind: 'READY' };
      } catch (e) {
        return classifyReadinessFromRevert(e);
      }
    },

    async estimateFinalization(
      finalization: WithdrawalFinalization,
    ): Promise<FinalizationEstimate> {
      const target = await finalizationTarget(finalization.protocol);
      const l1Signer = client.getL1Signer();

      const gasLimit = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.estimate,
        () => {
          if (finalization.protocol === 'legacy-withdrawal') {
            const c = new Contract(target, IL1NullifierABI, l1Signer);
            return c.finalizeDeposit.estimateGas(finalization.params);
          }
          const handler = new Contract(target, IInteropHandlerABI, l1Signer);
          return handler.executeBundle.estimateGas(
            finalization.params.bundle,
            finalization.params.proof,
          );
        },
        {
          ctx: { where: 'estimateGas(finalize)', protocol: finalization.protocol, target },
          message: 'Failed to estimate gas for withdrawal finalization.',
        },
      );

      const feeData = await wrapAs('RPC', OP_WITHDRAWALS.finalize.estimate, () => l1.getFeeData(), {
        ctx: { where: 'l1.getFeeData' },
        message: 'Failed to estimate fee data for withdrawal finalization.',
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

      return {
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
      };
    },

    async finalize(finalization: WithdrawalFinalization) {
      const target = await finalizationTarget(finalization.protocol);
      try {
        const sent = await (async (): Promise<ContractTransactionResponse> => {
          if (finalization.protocol === 'legacy-withdrawal') {
            const c = new Contract(target, IL1NullifierABI, signer);
            return (await c.finalizeDeposit(finalization.params)) as ContractTransactionResponse;
          }
          const handler = new Contract(target, IInteropHandlerABI, signer);
          return (await handler.executeBundle(
            finalization.params.bundle,
            finalization.params.proof,
          )) as ContractTransactionResponse;
        })();

        const hash = sent.hash;

        return {
          hash,
          wait: async (): Promise<TransactionReceipt> => {
            try {
              const receipt = await sent.wait();
              if (!receipt) {
                // ethers returns null when the tx was replaced or dropped before confirmation.
                throw createError('EXECUTION', {
                  resource: 'withdrawals',
                  operation: OP_WITHDRAWALS.finalize.wait,
                  message: 'Withdrawal finalization transaction produced no receipt.',
                  context: { txHash: hash, protocol: finalization.protocol },
                });
              }
              return receipt;
            } catch (e) {
              throw toZKsyncError(
                'EXECUTION',
                {
                  resource: 'withdrawals',
                  operation: OP_WITHDRAWALS.finalize.wait,
                  message: 'Failed while waiting for the withdrawal finalization transaction.',
                  context: { txHash: hash, protocol: finalization.protocol },
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
            message: 'Failed to send the withdrawal finalization transaction.',
            context: { protocol: finalization.protocol, target },
          },
          e,
        );
      }
    },
  };
}
