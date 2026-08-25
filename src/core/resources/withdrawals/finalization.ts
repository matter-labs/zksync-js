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
 * Read **positionally rather than by ABI**, which is what makes it version-proof. All three of the
 * event's parameters are non-indexed, and the first two are static `bytes32`, so the hash is always
 * the second data word. That sidesteps two things that are *not* stable across v32 revisions:
 *
 *  - the event's `topic0`, which moved when `BundleAttributes` gained its `salt` field, and
 *  - `InteropDataEncoding.encodeInteropBundleHash`, which was `keccak256(abi.encode(sourceChainId,
 *    bundle))` in the earlier atomic-interop line and is `keccak256(bundle)` in the release line.
 *
 * Both revisions report protocol `0.32.0`, so the version cannot tell them apart — taking the hash
 * the chain itself emitted avoids having to. Identified by emitter plus arity: `InteropBundleSent`
 * is the InteropCenter's only fully non-indexed event, so it is the one with a single topic.
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
}

/**
 * Assembles the `executeBundle` arguments.
 *
 * `bundleHash` is whatever the chain emitted when it accepted the bundle. It falls back to
 * `keccak256(bundle)` — the release line's `InteropDataEncoding.encodeInteropBundleHash` — only when
 * the emitted value is unavailable. The hash is what keys `bundleStatus` on the handler, so getting
 * it wrong does not break finalization itself but does make the withdrawal look permanently
 * unfinalized, which in turn makes a retry re-send a transaction that then reverts with
 * `BundleAlreadyProcessed`.
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
        sender: L2_INTEROP_CENTER_ADDRESS,
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

/** True once the bundle's calls have run — i.e. the withdrawal is finalized. */
export function isBundleFinalized(status: BundleStatus): boolean {
  return status === BundleStatus.FullyExecuted || status === BundleStatus.Unbundled;
}
