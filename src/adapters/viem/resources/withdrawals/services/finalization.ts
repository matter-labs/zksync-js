// src/adapters/viem/resources/withdrawals/services/finalization.ts
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

import type { Address, Hex } from '../../../../../core/types/primitives';
import type { ViemClient } from '../../../client';
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
  classifyBundleOutcome,
  parseBundleHashFromLogs,
  BundleStatus,
  type BundleOutcome,
} from '../../../../../core/resources/withdrawals/finalization';
import { createErrorHandlers } from '../../../errors/error-ops';
import { classifyReadinessFromRevert } from '../../../errors/revert';
import { OP_WITHDRAWALS } from '../../../../../core/types';
import { createError } from '../../../../../core/errors/factory';
import { toZKsyncError } from '../../../errors/error-ops';
import { createWithdrawalProtocolService, type WithdrawalProtocolService } from './protocol';

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
   * Classify the withdrawal's on-chain outcome. Distinguishes a terminally-failed bundle (unwound
   * with its call cancelled) from one that is merely not finalized yet — which
   * {@link isWithdrawalFinalized} collapses into `false`.
   */
  bundleOutcome(finalization: WithdrawalFinalization): Promise<BundleOutcome>;

  /** Simulate finalization on L1 to check readiness. */
  simulateFinalizeReadiness(finalization: WithdrawalFinalization): Promise<FinalizeReadiness>;

  /** Estimate gas & fees for finalization on L1. */
  estimateFinalization(finalization: WithdrawalFinalization): Promise<FinalizationEstimate>;

  /** Send the finalization transaction on L1. */
  finalize(
    finalization: WithdrawalFinalization,
  ): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }>;
}

export function createFinalizationServices(
  client: ViemClient,
  /**
   * Withdrawal-protocol detection. Optional: constructed per client when omitted, so
   * `createFinalizationServices(client)` keeps working. Pass one in to share the detection cache
   * with a withdrawals resource built over the same client.
   */
  protocolService: WithdrawalProtocolService = createWithdrawalProtocolService(client),
): FinalizationServices {
  /** The L1 contract that finalizes withdrawals under the given protocol. */
  async function finalizationTarget(
    protocol: WithdrawalFinalization['protocol'],
  ): Promise<Address> {
    const { l1Nullifier } = await client.ensureAddresses();
    if (protocol === 'legacy-withdrawal') return l1Nullifier;

    // The nullifier is the stable, already-resolved anchor, and it points at the handler that took
    // over its finalization duties — so the handler needs no extra configuration.
    return await wrapAs(
      'CONTRACT',
      OP_WITHDRAWALS.finalize.fetchParams.receipt,
      () =>
        client.l1.readContract({
          address: l1Nullifier,
          abi: IL1NullifierV32ABI as Abi,
          functionName: 'l1InteropHandler',
        }) as Promise<Address>,
      {
        ctx: { where: 'L1Nullifier.l1InteropHandler', l1Nullifier },
        message:
          'Failed to resolve the L1 interop handler. The chain reports protocol v32+, but its ' +
          'L1Nullifier does not expose `l1InteropHandler()`.',
      },
    );
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
      () => {
        const [decoded] = decodeAbiParameters([{ type: 'bytes' }], ev.data);
        return Promise.resolve(decoded);
      },
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

    const chainId = await wrapAs(
      'RPC',
      OP_WITHDRAWALS.finalize.fetchParams.network,
      () => client.l2.getChainId(),
      { ctx: { where: 'l2.getChainId' }, message: 'Failed to read L2 chain id.' },
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

  async function bundleOutcome(finalization: WithdrawalFinalization): Promise<BundleOutcome> {
    const target = await finalizationTarget(finalization.protocol);

    if (finalization.protocol === 'legacy-withdrawal') {
      const done = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.isFinalized,
        () =>
          client.l1.readContract({
            address: target,
            abi: IL1NullifierMini,
            functionName: 'isWithdrawalFinalized',
            args: [
              finalization.params.chainId,
              finalization.params.l2BatchNumber,
              finalization.params.l2MessageIndex,
            ],
          }),
        {
          ctx: { where: 'isWithdrawalFinalized', params: finalization.params },
          message: 'Failed to read finalization status.',
        },
      );
      return done ? 'finalized' : 'pending';
    }

    const { bundleHash } = finalization.params;
    const status = Number(
      await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.isFinalized,
        () =>
          client.l1.readContract({
            address: target,
            abi: IInteropHandlerABI as Abi,
            functionName: 'bundleStatus',
            args: [bundleHash],
          }) as Promise<number | bigint>,
        {
          ctx: { where: 'L1InteropHandler.bundleStatus', bundleHash },
          message: 'Failed to read bundle status.',
        },
      ),
    ) as BundleStatus;

    // Only `Unbundled` needs the per-call status: the unbundler may have cancelled the withdrawal's
    // call rather than executing it, in which case nothing was paid out.
    if (status !== BundleStatus.Unbundled) return classifyBundleOutcome(status);

    const callStatus = Number(
      await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.isFinalized,
        () =>
          client.l1.readContract({
            address: target,
            abi: IInteropHandlerABI as Abi,
            functionName: 'callStatus',
            args: [bundleHash, 0n],
          }) as Promise<number | bigint>,
        {
          ctx: { where: 'L1InteropHandler.callStatus', bundleHash },
          message: 'Failed to read bundle call status.',
        },
      ),
    ) as CallStatus;

    return classifyBundleOutcome(status, callStatus);
  }

  async function isWithdrawalFinalized(finalization: WithdrawalFinalization): Promise<boolean> {
    return (await bundleOutcome(finalization)) === 'finalized';
  }

  return {
    fetchFinalization,
    isWithdrawalFinalized,
    bundleOutcome,

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
          await client.l1.simulateContract({
            address: target,
            abi: IL1NullifierABI as Abi,
            functionName: 'finalizeDeposit',
            args: [finalization.params],
            account: client.account,
          });
        } else {
          await client.l1.simulateContract({
            address: target,
            abi: IInteropHandlerABI as Abi,
            functionName: 'executeBundle',
            args: [finalization.params.bundle, finalization.params.proof],
            account: client.account,
          });
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

      const gasLimit = await wrapAs(
        'RPC',
        OP_WITHDRAWALS.finalize.estimate,
        () =>
          finalization.protocol === 'legacy-withdrawal'
            ? client.l1.estimateContractGas({
                address: target,
                abi: IL1NullifierABI as Abi,
                functionName: 'finalizeDeposit',
                args: [finalization.params],
                account: client.account,
              })
            : client.l1.estimateContractGas({
                address: target,
                abi: IInteropHandlerABI as Abi,
                functionName: 'executeBundle',
                args: [finalization.params.bundle, finalization.params.proof],
                account: client.account,
              }),
        {
          ctx: {
            where: 'estimateContractGas(finalize)',
            protocol: finalization.protocol,
            target,
          },
          message: 'Failed to estimate gas for withdrawal finalization.',
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
            message: 'Failed to read gas price for withdrawal finalization.',
          },
        );

        maxFeePerGas = gasPrice;
        maxPriorityFeePerGas = 0n;
      }

      return { gasLimit, maxFeePerGas, maxPriorityFeePerGas };
    },

    async finalize(finalization: WithdrawalFinalization) {
      const target = await finalizationTarget(finalization.protocol);
      try {
        const hash =
          finalization.protocol === 'legacy-withdrawal'
            ? await client.l1Wallet.writeContract({
                address: target,
                abi: IL1NullifierABI as Abi,
                functionName: 'finalizeDeposit',
                args: [finalization.params],
                account: client.account,
              })
            : await client.l1Wallet.writeContract({
                address: target,
                abi: IInteropHandlerABI as Abi,
                functionName: 'executeBundle',
                args: [finalization.params.bundle, finalization.params.proof],
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
