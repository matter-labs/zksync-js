// src/core/resources/withdrawals/finalization.ts
//
// Adapter-agnostic derivation of the arguments `L1InteropHandler.executeBundle` needs for a
// protocol v32+ withdrawal.

import { keccak_256 } from '@noble/hashes/sha3';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';

import type { Address, Hex } from '../../types/primitives';
import { BUNDLE_IDENTIFIER, L2_INTEROP_CENTER_ADDRESS } from '../../constants';
import { createError } from '../../errors/factory';
import { OP_WITHDRAWALS } from '../../types/errors';

/**
 * `MessageInclusionProof` as consumed by `L1InteropHandler.executeBundle`.
 *
 * Note the handler substitutes `message.data` with `BUNDLE_IDENTIFIER || bundle` before proving
 * inclusion, so the value passed here only has to be well-formed, and `message.sender` must be the
 * L2 InteropCenter — the handler rejects anything else.
 */
export interface WithdrawalInclusionProof {
  chainId: bigint;
  l1BatchNumber: bigint;
  l2MessageIndex: bigint;
  message: {
    txNumberInBatch: number;
    sender: Address;
    data: Hex;
  };
  proof: Hex[];
}

/** Everything needed to finalize a v32 withdrawal on L1. */
export interface WithdrawalBundleFinalization {
  /** ABI-encoded `InteropBundle` — the `_bundle` argument of `executeBundle`. */
  bundle: Hex;
  /** `keccak256(bundle)`, the handler's key for bundle status. */
  bundleHash: Hex;
  /** The `_proof` argument of `executeBundle`. */
  proof: WithdrawalInclusionProof;
}

/** keccak256 over raw hex bytes. */
export function keccakHex(data: Hex): Hex {
  return `0x${bytesToHex(keccak_256(hexToBytes(data.slice(2))))}`;
}

/**
 * Strips the `BUNDLE_IDENTIFIER` prefix the InteropCenter puts in front of every published bundle
 * message, yielding the ABI-encoded `InteropBundle`.
 *
 * A message that does not carry the prefix is not a withdrawal bundle — most likely a v31-style
 * withdrawal message being fed to the v32 path — so this fails loudly rather than truncating.
 */
export function stripBundleIdentifier(messageData: Hex): Hex {
  const prefix = `0x${messageData.slice(2, 4)}`;
  if (prefix !== BUNDLE_IDENTIFIER) {
    throw createError('STATE', {
      resource: 'withdrawals',
      operation: OP_WITHDRAWALS.finalize.fetchParams.decodeMessage,
      message:
        'L2→L1 message is not an interop bundle. This withdrawal was most likely initiated ' +
        'before the chain upgraded to protocol v32 and cannot be finalized through the ' +
        'interop handler.',
      context: { prefix, expected: BUNDLE_IDENTIFIER },
    });
  }
  return `0x${messageData.slice(4)}`;
}

/**
 * Reads the authoritative `interopBundleHash` out of the `InteropBundleSent` log the L2
 * InteropCenter emits, or `undefined` when no such log is present.
 *
 * This is the value the InteropCenter itself computed and the handler keys `bundleStatus` on, so
 * using it means the SDK never has to assume a hash derivation. On the current contracts that
 * derivation is `keccak256(bundle)` and the emitted value matches it exactly — the point is not to
 * paper over a mismatch but to avoid re-deriving a protocol detail we are handed for free, out of a
 * receipt we already fetch.
 *
 * Read **positionally rather than by ABI**: all three of the event's parameters are non-indexed and
 * the first two are static `bytes32`, so the hash is always the second data word. That keeps it
 * working across the `topic0` change that `BundleAttributes.salt` caused, without needing a
 * version-aware ABI for the bundle tuple. Identified by emitter plus arity — `InteropBundleSent` is
 * the InteropCenter's only fully non-indexed event, so it is the one with a single topic.
 */
export function parseBundleHashFromLogs(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
  interopCenter: Address = L2_INTEROP_CENTER_ADDRESS,
): Hex | undefined {
  const center = interopCenter.toLowerCase();
  for (const log of logs) {
    if (log.address?.toLowerCase() !== center) continue;
    if (log.topics?.length !== 1) continue;
    // l2l1MsgHash + interopBundleHash + the bundle's offset word.
    if (!log.data || (log.data.length - 2) / 64 < 3) continue;
    return `0x${log.data.slice(66, 130)}`;
  }
  return undefined;
}

export interface BuildWithdrawalFinalizationInput {
  /** Raw `bytes` payload of the `L1MessageSent` event, including the `0x01` prefix. */
  messageData: Hex;
  /** Chain id of the source L2. */
  sourceChainId: bigint;
  /** Index of the withdrawing transaction within its batch. */
  txNumberInBatch: number;
  /** Normalized `zks_getL2ToL1LogProof` result. */
  proof: { batchNumber: bigint; id: bigint; proof: Hex[] };
  /**
   * The bundle hash as emitted by the InteropCenter, from {@link parseBundleHashFromLogs}. Strongly
   * preferred over the computed fallback — see that function for why.
   */
  bundleHash?: Hex;
  /**
   * The InteropCenter that actually sent the bundle. Must be the resolved address rather than the
   * canonical constant: the L1 handler checks `message.sender` against the center it expects, so a
   * client using `overrides.interopCenter` would otherwise send through the override and then build
   * a proof naming the canonical address, which cannot finalize.
   */
  interopCenter?: Address;
}

/**
 * Assembles the `executeBundle` arguments.
 *
 * `bundleHash` is whatever the chain emitted when it accepted the bundle, falling back to
 * `keccak256(bundle)` — `InteropDataEncoding.encodeInteropBundleHash` — when no log is available.
 *
 * The hash keys `bundleStatus` on the handler, so getting it wrong does not break finalization
 * itself but does make the withdrawal look permanently unfinalized, which in turn makes a retry
 * re-send a transaction that then reverts with `BundleAlreadyProcessed`. That failure mode is why
 * the emitted value is preferred over a derivation.
 */
export function buildWithdrawalFinalization(
  input: BuildWithdrawalFinalizationInput,
): WithdrawalBundleFinalization {
  const { messageData, sourceChainId, txNumberInBatch, proof } = input;
  const bundle = stripBundleIdentifier(messageData);

  return {
    bundle,
    bundleHash: input.bundleHash ?? keccakHex(bundle),
    proof: {
      chainId: sourceChainId,
      l1BatchNumber: proof.batchNumber,
      l2MessageIndex: proof.id,
      message: {
        txNumberInBatch,
        sender: input.interopCenter ?? L2_INTEROP_CENTER_ADDRESS,
        data: messageData,
      },
      proof: proof.proof,
    },
  };
}

/**
 * `BundleStatus` as stored by `InteropHandlerBase.bundleStatus`. Stable across v31/v32.
 */
export enum BundleStatus {
  Unreceived = 0,
  Verified = 1,
  FullyExecuted = 2,
  Unbundled = 3,
}

/** `CallStatus` as stored by `InteropHandlerBase.callStatus`. */
export enum CallStatus {
  Unprocessed = 0,
  Executed = 1,
  Cancelled = 2,
}

/**
 * Outcome of a withdrawal bundle.
 *
 * - `finalized` — the withdrawal's call ran; the funds are released on L1.
 * - `failed` — terminally unwound; the call was cancelled and the funds were **not** released.
 * - `pending` — not resolved yet.
 */
export type BundleOutcome = 'finalized' | 'failed' | 'pending';

/**
 * Classifies a withdrawal bundle from its on-chain status.
 *
 * `FullyExecuted` is the only status that means "done" on its own. `Unbundled` is *terminal but not
 * a success*: `unbundleBundle` lets the unbundler mark each call `Executed` or `Cancelled`, so a
 * withdrawal whose single call was cancelled never delivered the funds. Treating `Unbundled` as
 * finalized would make `status()` report `FINALIZED` for a withdrawal that paid out nothing, and
 * silence any further `finalize()` attempt.
 *
 * @param bundleStatus Value of `bundleStatus(bundleHash)`.
 * @param callStatus Value of `callStatus(bundleHash, 0)` — a withdrawal bundle has exactly one
 * call. Only consulted when `bundleStatus` is `Unbundled`.
 */
export function classifyBundleOutcome(
  bundleStatus: BundleStatus,
  callStatus?: CallStatus,
): BundleOutcome {
  if (bundleStatus === BundleStatus.FullyExecuted) return 'finalized';
  if (bundleStatus !== BundleStatus.Unbundled) return 'pending';

  switch (callStatus) {
    case CallStatus.Executed:
      return 'finalized';
    case CallStatus.Cancelled:
      return 'failed';
    default:
      // Left `Unprocessed` by the unbundler: a later `unbundleBundle` can still execute it.
      return 'pending';
  }
}

/**
 * True once the withdrawal's funds are released on L1.
 *
 * @deprecated Cannot distinguish a cancelled unbundle from a successful one — pass the call status
 * to {@link classifyBundleOutcome} instead.
 */
export function isBundleFinalized(status: BundleStatus): boolean {
  return status === BundleStatus.FullyExecuted;
}
