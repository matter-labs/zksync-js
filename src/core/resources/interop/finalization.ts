// src/core/resources/interop/finalization.ts
import type { Address, Hex } from '../../types/primitives';
import type {
  InteropFinalizationInfo,
  InteropExpectedRoot,
  InteropMessageProof,
  InteropWaitable,
} from '../../types/flows/interop';
import type { Log, TxReceipt } from '../../types/transactions';
import type { ProofNormalized, ReceiptWithL2ToL1 } from '../../rpc/types';
import { BUNDLE_IDENTIFIER, L2_INTEROP_CENTER_ADDRESS } from '../../constants';
import { OP_INTEROP } from '../../types/errors';
import { createError } from '../../errors/factory';
import { isL1MessageSentLog } from '../../utils/events';

export interface BundleReceiptInfo {
  bundleHash: Hex;
  dstChainId: bigint;
  sourceChainId: bigint;
  l1MessageData: Hex;
  l2ToL1LogIndex: number;
  txNumberInBatch: number;
  rawReceipt: ReceiptWithL2ToL1;
}

export const DEFAULT_POLL_MS = 1_000;
export const DEFAULT_TIMEOUT_MS = 300_000;

interface ResolvedInteropIds {
  l2SrcTxHash?: Hex;
  bundleHash?: Hex;
  dstChainId?: bigint;
  dstExecTxHash?: Hex;
}

export function resolveIdsFromWaitable(input: InteropWaitable): ResolvedInteropIds {
  if (typeof input === 'string') {
    return { l2SrcTxHash: input };
  }

  return {
    l2SrcTxHash: input.l2SrcTxHash,
    bundleHash: input.bundleHash,
    dstChainId: input.dstChainId,
    dstExecTxHash: input.dstExecTxHash,
  };
}

export interface ParseBundleSentInput {
  receipt: TxReceipt;
  interopCenter: Address;
  interopBundleSentTopic: Hex;
  decodeInteropBundleSent: (log: { data: Hex; topics: Hex[] }) => {
    bundleHash: Hex;
    sourceChainId: bigint;
    destinationChainId: bigint;
  };
}

export function parseBundleSentFromReceipt(input: ParseBundleSentInput): {
  bundleHash: Hex;
  dstChainId: bigint;
} {
  const { receipt, interopCenter, interopBundleSentTopic, decodeInteropBundleSent } = input;

  const bundleSentLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === interopCenter.toLowerCase() &&
      log.topics[0].toLowerCase() === interopBundleSentTopic.toLowerCase(),
  );

  if (!bundleSentLog) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.parseSentLog,
      message: 'Failed to locate InteropBundleSent event in source receipt.',
      context: { receipt, interopCenter },
    });
  }

  const decoded = decodeInteropBundleSent({
    data: bundleSentLog.data,
    topics: bundleSentLog.topics,
  });

  return { bundleHash: decoded.bundleHash, dstChainId: decoded.destinationChainId };
}

export interface ParseBundleReceiptParams {
  rawReceipt: ReceiptWithL2ToL1;
  interopCenter: Address;
  interopBundleSentTopic: Hex;
  decodeInteropBundleSent: (log: { data: Hex; topics: Hex[] }) => {
    bundleHash: Hex;
    sourceChainId: bigint;
    destinationChainId: bigint;
  };
  decodeL1MessageData: (log: Log) => Hex;
  l2SrcTxHash: Hex;
}

export function parseBundleReceiptInfo(params: ParseBundleReceiptParams): BundleReceiptInfo {
  const {
    rawReceipt,
    interopCenter,
    interopBundleSentTopic,
    decodeInteropBundleSent,
    decodeL1MessageData,
    l2SrcTxHash,
  } = params;
  let l2ToL1LogIndex = -1;
  let l1MessageData: Hex | null = null;
  let found: { bundleHash: Hex; dstChainId: bigint; sourceChainId: bigint } | undefined;

  for (const log of rawReceipt.logs!) {
    if (isL1MessageSentLog(log)) {
      l2ToL1LogIndex += 1;
      try {
        l1MessageData = decodeL1MessageData(log);
      } catch (e) {
        throw createError('STATE', {
          resource: 'interop',
          operation: OP_INTEROP.svc.status.parseSentLog,
          message: 'Failed to decode L1MessageSent log data for interop bundle.',
          context: { l2SrcTxHash, l2ToL1LogIndex },
          cause: e as Error,
        });
      }
      continue;
    }

    if (
      log.address.toLowerCase() !== interopCenter.toLowerCase() ||
      log.topics[0].toLowerCase() !== interopBundleSentTopic.toLowerCase()
    )
      continue;

    const decoded = decodeInteropBundleSent({
      data: log.data,
      topics: log.topics,
    });

    found = {
      bundleHash: decoded.bundleHash,
      dstChainId: decoded.destinationChainId,
      sourceChainId: decoded.sourceChainId,
    };
    break;
  }

  if (!found) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.parseSentLog,
      message: 'Failed to locate InteropBundleSent event in source receipt.',
      context: { l2SrcTxHash, interopCenter },
    });
  }

  if (!l1MessageData) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.parseSentLog,
      message: 'Failed to locate L1MessageSent log data for interop bundle.',
      context: { l2SrcTxHash, interopCenter },
    });
  }

  return {
    bundleHash: found.bundleHash,
    dstChainId: found.dstChainId,
    sourceChainId: found.sourceChainId,
    l1MessageData,
    l2ToL1LogIndex,
    txNumberInBatch: Number(rawReceipt.transactionIndex),
    rawReceipt,
  };
}

// Finalization helpers
export function getBundleEncodedData(messageData: Hex): Hex {
  // InteropCenter prepends BUNDLE_IDENTIFIER (0x01) to the message
  // Strip it off to get the original encoded bundle data
  const prefix = `0x${messageData.slice(2, 4)}`;
  if (prefix !== BUNDLE_IDENTIFIER) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.wait,
      message: 'Unexpected bundle prefix in L1MessageSent data.',
      context: { prefix, expected: BUNDLE_IDENTIFIER },
    });
  }

  return `0x${messageData.slice(4)}`;
}

export function buildFinalizationInfo(
  ids: { l2SrcTxHash: Hex; bundleHash?: Hex },
  bundleInfo: BundleReceiptInfo,
  proof: ProofNormalized,
  messageData: Hex,
): InteropFinalizationInfo {
  const expectedRoot: InteropExpectedRoot = {
    rootChainId: bundleInfo.sourceChainId,
    batchNumber: proof.batchNumber,
    expectedRoot: proof.root,
  };

  const messageProof: InteropMessageProof = {
    chainId: bundleInfo.sourceChainId,
    l1BatchNumber: proof.batchNumber,
    l2MessageIndex: proof.id,
    message: {
      txNumberInBatch: bundleInfo.txNumberInBatch,
      sender: L2_INTEROP_CENTER_ADDRESS,
      data: messageData,
    },
    proof: proof.proof,
  };

  return {
    l2SrcTxHash: ids.l2SrcTxHash,
    bundleHash: bundleInfo.bundleHash,
    dstChainId: bundleInfo.dstChainId,
    expectedRoot,
    proof: messageProof,
    encodedData: getBundleEncodedData(messageData),
  };
}
