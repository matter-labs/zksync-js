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

export interface BuildWithdrawalFinalizationInput {
  /** Raw `bytes` payload of the `L1MessageSent` event, including the `0x01` prefix. */
  messageData: Hex;
  /** Chain id of the source L2. */
  sourceChainId: bigint;
  /** Index of the withdrawing transaction within its batch. */
  txNumberInBatch: number;
  /** Normalized `zks_getL2ToL1LogProof` result. */
  proof: { batchNumber: bigint; id: bigint; proof: Hex[] };
}

/**
 * Assembles the `executeBundle` arguments.
 *
 * The bundle hash is derived as `keccak256(abi.encode(bundle))` — exactly what
 * `InteropDataEncoding.encodeInteropBundleHash` does on-chain — rather than read out of the
 * `InteropBundleSent` event. That matters for version tolerance: v32 added a `salt` field to the
 * nested `BundleAttributes`, which changed that event's topic0, so decoding it requires knowing the
 * protocol version up front. Hashing the published bytes does not.
 */
export function buildWithdrawalFinalization(
  input: BuildWithdrawalFinalizationInput,
): WithdrawalBundleFinalization {
  const { messageData, sourceChainId, txNumberInBatch, proof } = input;
  const bundle = stripBundleIdentifier(messageData);

  return {
    bundle,
    bundleHash: keccakHex(bundle),
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
