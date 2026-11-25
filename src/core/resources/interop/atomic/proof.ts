// src/core/resources/interop/atomic/proof.ts
//
// Reading atomic-interop proofs: where a multi-hop settlement proof ends on the settlement layer,
// and turning the node's IMT proofs into the struct the contracts take.

import type { Hex } from '../../../types/primitives';
import type {
  ImtProof,
  ImtProofResponse,
  SettlementLayerReference,
} from '../../../types/flows/atomic-interop';
import { SUPPORTED_PROOF_METADATA_VERSION } from '../../../constants';
import { OP_INTEROP } from '../../../types/errors';
import { createError } from '../../../errors/factory';
import { isHash66 } from '../../../utils/hash';

function malformed(message: string, context: Record<string, unknown>): never {
  throw createError('VALIDATION', {
    resource: 'interop',
    operation: OP_INTEROP.atomic.settlementReference,
    message,
    context,
  });
}

/**
 * Reads where a multi-hop settlement proof ends on the settlement layer, exactly as
 * `MessageHashing.readSettlementLayerReference` does: the settlement-layer block (or batch) whose
 * interop root the proof ends at, that layer's chain id, and the time the layer included the proven
 * batch, which is what an atomic flow's deadline is compared with.
 *
 * The proof's first word is its metadata: a version byte, the length of the path to the batch root,
 * the length of the path to the settlement layer's root, and whether the proof stops at the batch
 * root; the remaining 28 bytes are zero. After the metadata and the path to the batch root come the
 * batch's timestamp, the batch-leaf mask, the path to the settlement layer's root, the packed batch
 * information (block number in the high 128 bits) and the settlement layer's chain id.
 *
 * The values are only as trustworthy as the proof: the contracts authenticate them when they verify
 * it, so use them to decide *when* to submit a proof, never as evidence on their own.
 *
 * @throws ZKsyncError (`VALIDATION`) for an empty or short proof, an unsupported metadata version,
 * a legacy (metadata-less) proof, or a proof that stops at the batch root and so has no
 * settlement-layer reference.
 */
export function readSettlementLayerReference(
  settlementProof: readonly Hex[],
): SettlementLayerReference {
  const words = settlementProof;
  if (words.length === 0) {
    malformed('The settlement proof is empty.', {});
  }
  words.forEach((word, index) => {
    if (!isHash66(word)) {
      malformed('A settlement proof word must be 32 bytes of 0x-prefixed hex.', { index, word });
    }
  });

  const metadata = words[0].slice(2);
  // The new format has zeroes after the first 4 bytes; anything else is a legacy plain Merkle path,
  // which always stops at the batch root.
  if (BigInt(`0x${metadata.slice(8)}`) !== 0n) {
    malformed('The settlement proof has no metadata word, so it stops at the batch root.', {
      metadata: words[0],
    });
  }
  const byteAt = (i: number) => parseInt(metadata.slice(i * 2, i * 2 + 2), 16);
  const version = byteAt(0);
  if (version !== SUPPORTED_PROOF_METADATA_VERSION) {
    malformed('Unsupported settlement proof metadata version.', {
      expected: SUPPORTED_PROOF_METADATA_VERSION,
      actual: version,
    });
  }
  const logLeafProofLen = byteAt(1);
  const batchLeafProofLen = byteAt(2);
  const finalProofNode = byteAt(3) !== 0;
  if (finalProofNode) {
    malformed(
      'The settlement proof stops at the batch root and does not reach the settlement layer.',
      {
        metadata: words[0],
      },
    );
  }

  const ptr = 1 + logLeafProofLen;
  const last = ptr + 3 + batchLeafProofLen;
  if (last >= words.length) {
    malformed('The settlement proof is shorter than its metadata says.', {
      length: words.length,
      required: last + 1,
    });
  }

  const packedBatchInfo = BigInt(words[ptr + 2 + batchLeafProofLen]);
  return {
    settlementLayerBatchNumber: packedBatchInfo >> 128n,
    settlementLayerChainId: BigInt(words[last]),
    l1BatchTimestamp: BigInt(words[ptr]),
  };
}

/**
 * The on-chain `ImtProof` for a proof the node returned. The node omits `sourceChainId` because it
 * only proves its own chain, so pass the chain the proof came from. The same conversion serves
 * inclusion proofs (execution) and absence proofs (refunds); `provesAgainstBeginRoot` is passed
 * through from the node.
 */
export function toOnchainImtProof(proof: ImtProofResponse, sourceChainId: bigint): ImtProof {
  return {
    sourceChainId,
    batchNumber: proof.batchNumber,
    chainImtRoot: proof.chainImtRoot,
    provesAgainstBeginRoot: proof.provesAgainstBeginRoot,
    settlementProof: [...proof.settlementProof],
    leaf: {
      value: proof.leaf.value,
      nextIndex: proof.leaf.nextIndex,
      nextValue: proof.leaf.nextValue,
    },
    imtLeafIndex: proof.imtLeafIndex,
    imtProof: [...proof.imtProof],
  };
}
