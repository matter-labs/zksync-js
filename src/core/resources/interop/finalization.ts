// src/core/resources/interop/finalization.ts
//
// Pure helper functions for interop finalization.
// Orchestration logic lives in adapters (viem/ethers finalization.ts).

import type { Address, Hex } from '../../types/primitives';
import type {
  InteropFinalizationInfo,
  InteropExpectedRoot,
  InteropMessageProof,
  InteropWaitable,
} from '../../types/flows/interop';
import type { ProofNormalized, ReceiptWithL2ToL1 } from '../../rpc/types';
import {
  BUNDLE_IDENTIFIER,
  L1_MESSENGER_ADDRESS,
  L2_INTEROP_CENTER_ADDRESS,
  TOPIC_L1_MESSAGE_SENT_LEG,
} from '../../constants';
import { OP_INTEROP, isZKsyncError } from '../../types/errors';
import { createError } from '../../errors/factory';
import { messengerLogIndex } from '../withdrawals/logs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InteropLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  transactionHash?: Hex;
};

export type InteropReceipt = { logs?: InteropLog[] };

export interface BundleReceiptInfo {
  bundleHash: Hex;
  dstChainId: bigint;
  sourceChainId: bigint;
  l1MessageData: Hex;
  l2ToL1LogIndex: number;
  txNumberInBatch: number;
  rawReceipt: ReceiptWithL2ToL1;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_POLL_MS = 1_000;
export const DEFAULT_TIMEOUT_MS = 300_000;
export const ZERO_HASH: Hex = `0x${'0'.repeat(64)}`;

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

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

  const asObj = input as ResolvedInteropIds;

  return {
    l2SrcTxHash: asObj.l2SrcTxHash,
    bundleHash: asObj.bundleHash,
    dstChainId: asObj.dstChainId,
    dstExecTxHash: asObj.dstExecTxHash,
  };
}

export function isL1MessageSentLog(log: InteropLog): boolean {
  return (
    log.address.toLowerCase() === L1_MESSENGER_ADDRESS.toLowerCase() &&
    log.topics[0].toLowerCase() === TOPIC_L1_MESSAGE_SENT_LEG.toLowerCase()
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isProofNotReadyError(err: unknown): boolean {
  if (!isZKsyncError(err)) return false;
  if (err.envelope.operation !== 'zksrpc.getL2ToL1LogProof') return false;

  if (
    err.envelope.type === 'STATE' &&
    err.envelope.message.toLowerCase().includes('proof not yet available')
  ) {
    return true;
  }

  const cause = err.envelope.cause as { message?: unknown; code?: unknown } | undefined;
  const causeMessage = typeof cause?.message === 'string' ? cause.message.toLowerCase() : '';

  return (
    causeMessage.includes('l1 batch') &&
    causeMessage.includes('not') &&
    causeMessage.includes('executed')
  );
}

export function isReceiptNotFoundError(err: unknown): boolean {
  if (!isZKsyncError(err)) return false;
  return (
    err.envelope.operation === OP_INTEROP.svc.status.sourceReceipt &&
    err.envelope.type === 'STATE' &&
    err.envelope.message.toLowerCase().includes('receipt not found')
  );
}

// ---------------------------------------------------------------------------
// Receipt parsing helpers (pure, take decoded data as input)
// ---------------------------------------------------------------------------

export interface ParseBundleSentInput {
  receipt: InteropReceipt;
  interopCenter: Address;
  interopBundleSentTopic: Hex;
  decodeInteropBundleSent: (log: { data: Hex; topics: Hex[] }) => {
    bundleHash: Hex;
    sourceChainId: bigint;
    destinationChainId: bigint;
  };
}

export function parseBundleSentFromReceipt(
  input: ParseBundleSentInput,
  l2SrcTxHash: Hex,
): { bundleHash: Hex; dstChainId: bigint } {
  const { receipt, interopCenter, interopBundleSentTopic, decodeInteropBundleSent } = input;

  const logs = receipt.logs ?? [];
  const wantAddr = interopCenter.toLowerCase();
  const wantTopic = interopBundleSentTopic.toLowerCase();

  const found = logs.find(
    (log) =>
      (log.address ?? '').toLowerCase() === wantAddr &&
      (log.topics?.[0] ?? '').toLowerCase() === wantTopic,
  );

  if (!found) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.svc.status.parseSentLog,
      message: 'Failed to locate InteropBundleSent event in source receipt.',
      context: { l2SrcTxHash, interopCenter },
    });
  }

  const decoded = decodeInteropBundleSent({
    data: found.data,
    topics: found.topics,
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
  decodeL1MessageData: (log: InteropLog) => Hex;
  wantBundleHash?: Hex;
  l2SrcTxHash: Hex,
}

export function parseBundleReceiptInfo(
  params: ParseBundleReceiptParams,
): BundleReceiptInfo {
  const {
    rawReceipt,
    interopCenter,
    interopBundleSentTopic,
    decodeInteropBundleSent,
    decodeL1MessageData,
    wantBundleHash,
    l2SrcTxHash,
  } = params;
debugger;
  const wantAddr = interopCenter.toLowerCase();
  const wantTopic = interopBundleSentTopic.toLowerCase();

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

    if (log.address.toLowerCase() !== wantAddr || log.topics[0].toLowerCase() !== wantTopic) continue;

    const decoded = decodeInteropBundleSent({
      data: log.data,
      topics: log.topics,
    });

    if (wantBundleHash && decoded.bundleHash.toLowerCase() !== wantBundleHash.toLowerCase()) {
      continue;
    }

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
      context: { l2SrcTxHash, interopCenter, bundleHash: wantBundleHash },
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

// ---------------------------------------------------------------------------
// Finalization info building helpers
// ---------------------------------------------------------------------------

export function validateBundlePayload(messageData: Hex, l2SrcTxHash: Hex): Hex {
  if (messageData.length <= 4) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.wait,
      message: 'L1MessageSent data is too short to contain bundle payload.',
      context: { l2SrcTxHash },
    });
  }

  const prefix = `0x${messageData.slice(2, 4)}`.toLowerCase();
  if (prefix !== BUNDLE_IDENTIFIER.toLowerCase()) {
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
  if (!proof.root) {
    throw createError('STATE', {
      resource: 'interop',
      operation: OP_INTEROP.wait,
      message: 'L2->L1 log proof missing expected root.',
      context: { l2SrcTxHash: ids.l2SrcTxHash },
    });
  }

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

  const encodedData = validateBundlePayload(messageData, ids.l2SrcTxHash);

  return {
    l2SrcTxHash: ids.l2SrcTxHash,
    bundleHash: bundleInfo.bundleHash,
    dstChainId: bundleInfo.dstChainId,
    expectedRoot,
    proof: messageProof,
    encodedData,
  };
}

// ---------------------------------------------------------------------------
// Error creation helpers
// ---------------------------------------------------------------------------

export function createTimeoutError(
  operation: string,
  message: string,
  context: Record<string, unknown>,
): Error {
  return createError('TIMEOUT', {
    resource: 'interop',
    operation,
    message,
    context,
  });
}

export function createStateError(
  operation: string,
  message: string,
  context: Record<string, unknown>,
): Error {
  return createError('STATE', {
    resource: 'interop',
    operation,
    message,
    context,
  });
}
