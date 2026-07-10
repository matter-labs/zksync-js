import type { ProofNormalized, ReceiptWithL2ToL1 } from '../../rpc/types';
import type {
  InteropFinalizationInfo,
  InteropMessageProof,
  InteropPhase,
  InteropWaitable,
} from '../../types/flows/interop';
import type { Resource } from '../../types/errors';
import type { Address, Hex } from '../../types/primitives';
import type { Log, TxReceipt } from '../../types/transactions';
import { BUNDLE_IDENTIFIER, L2_INTEROP_CENTER_ADDRESS } from '../../constants';
import { createError } from '../../errors/factory';
import { OP_INTEROP, OP_WITHDRAWALS } from '../../types/errors';
import { sleep } from '../../utils';
import { isL1MessageSentLog } from '../../utils/events';

export const DEFAULT_POLL_MS = 1_000;
export const DEFAULT_TIMEOUT_MS = 300_000;

export interface BundleLifecycleErrors {
  resource: Extract<Resource, 'interop' | 'withdrawals'>;
  sourceReceiptOperation: string;
  parseReceiptOperation: string;
  bundleDataOperation: string;
  timeoutOperation: string;
  label: string;
}

export const INTEROP_BUNDLE_LIFECYCLE_ERRORS: BundleLifecycleErrors = {
  resource: 'interop',
  sourceReceiptOperation: OP_INTEROP.svc.status.sourceReceipt,
  parseReceiptOperation: OP_INTEROP.svc.status.parseSentLog,
  bundleDataOperation: OP_INTEROP.wait,
  timeoutOperation: OP_INTEROP.svc.wait.timeout,
  label: 'interop bundle',
};

export const WITHDRAWAL_BUNDLE_LIFECYCLE_ERRORS: BundleLifecycleErrors = {
  resource: 'withdrawals',
  sourceReceiptOperation: OP_WITHDRAWALS.finalize.fetchParams.receipt,
  parseReceiptOperation: OP_WITHDRAWALS.finalize.fetchParams.findMessage,
  bundleDataOperation: OP_WITHDRAWALS.finalize.fetchParams.decodeMessage,
  timeoutOperation: OP_WITHDRAWALS.wait,
  label: 'withdrawal bundle',
};

export interface BundleReceiptInfo {
  bundleHash: Hex;
  dstChainId: bigint;
  sourceChainId: bigint;
  l1MessageData: Hex;
  l2ToL1LogIndex: number;
  txNumberInBatch: number;
  rawReceipt: ReceiptWithL2ToL1;
}

interface ResolvedInteropIds {
  l2SrcTxHash?: Hex;
  bundleHash?: Hex;
  dstExecTxHash?: Hex;
}

export function resolveIdsFromWaitable(input: InteropWaitable): ResolvedInteropIds {
  if (typeof input === 'string') return { l2SrcTxHash: input };

  return {
    l2SrcTxHash: input.l2SrcTxHash,
    bundleHash: input.bundleHash,
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
  errors?: BundleLifecycleErrors;
}

export function parseBundleSentFromReceipt(input: ParseBundleSentInput): {
  bundleHash: Hex;
  dstChainId: bigint;
} {
  const {
    receipt,
    interopCenter,
    interopBundleSentTopic,
    decodeInteropBundleSent,
    errors = INTEROP_BUNDLE_LIFECYCLE_ERRORS,
  } = input;
  const bundleSentLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === interopCenter.toLowerCase() &&
      log.topics[0]?.toLowerCase() === interopBundleSentTopic.toLowerCase(),
  );

  if (!bundleSentLog) {
    throw createError('STATE', {
      resource: errors.resource,
      operation: errors.parseReceiptOperation,
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
  errors?: BundleLifecycleErrors;
}

export function parseBundleReceiptInfo(params: ParseBundleReceiptParams): BundleReceiptInfo {
  const {
    rawReceipt,
    interopCenter,
    interopBundleSentTopic,
    decodeInteropBundleSent,
    decodeL1MessageData,
    l2SrcTxHash,
    errors = INTEROP_BUNDLE_LIFECYCLE_ERRORS,
  } = params;
  let l2ToL1LogIndex = -1;
  let l1MessageData: Hex | null = null;
  let found: { bundleHash: Hex; dstChainId: bigint; sourceChainId: bigint } | undefined;

  for (const log of rawReceipt.logs ?? []) {
    if (isL1MessageSentLog(log)) {
      l2ToL1LogIndex += 1;
      try {
        l1MessageData = decodeL1MessageData(log);
      } catch (error) {
        throw createError('STATE', {
          resource: errors.resource,
          operation: errors.parseReceiptOperation,
          message: `Failed to decode L1MessageSent log data for ${errors.label}.`,
          context: { l2SrcTxHash, l2ToL1LogIndex },
          cause: error,
        });
      }
      continue;
    }

    if (
      log.address.toLowerCase() !== interopCenter.toLowerCase() ||
      log.topics[0]?.toLowerCase() !== interopBundleSentTopic.toLowerCase()
    ) {
      continue;
    }

    const decoded = decodeInteropBundleSent({ data: log.data, topics: log.topics });
    found = {
      bundleHash: decoded.bundleHash,
      dstChainId: decoded.destinationChainId,
      sourceChainId: decoded.sourceChainId,
    };
    break;
  }

  if (!found) {
    throw createError('STATE', {
      resource: errors.resource,
      operation: errors.parseReceiptOperation,
      message: 'Failed to locate InteropBundleSent event in source receipt.',
      context: { l2SrcTxHash, interopCenter },
    });
  }

  if (!l1MessageData) {
    throw createError('STATE', {
      resource: errors.resource,
      operation: errors.parseReceiptOperation,
      message: `Failed to locate L1MessageSent log data for ${errors.label}.`,
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

export function getBundleEncodedData(
  messageData: Hex,
  errors: BundleLifecycleErrors = INTEROP_BUNDLE_LIFECYCLE_ERRORS,
): Hex {
  const prefix = `0x${messageData.slice(2, 4)}`;
  if (prefix !== BUNDLE_IDENTIFIER) {
    throw createError('STATE', {
      resource: errors.resource,
      operation: errors.bundleDataOperation,
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
  errors: BundleLifecycleErrors = INTEROP_BUNDLE_LIFECYCLE_ERRORS,
): InteropFinalizationInfo {
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
    proof: messageProof,
    encodedData: getBundleEncodedData(messageData, errors),
  };
}

export type BundleLifecycleState = 'UNRECEIVED' | 'VERIFIED' | 'FULLY_EXECUTED' | 'UNBUNDLED';

export function decodeBundleStatus(
  rawStatus: number | bigint,
  errors: BundleLifecycleErrors = INTEROP_BUNDLE_LIFECYCLE_ERRORS,
): BundleLifecycleState {
  switch (Number(rawStatus)) {
    case 0:
      return 'UNRECEIVED';
    case 1:
      return 'VERIFIED';
    case 2:
      return 'FULLY_EXECUTED';
    case 3:
      return 'UNBUNDLED';
    default:
      throw createError('STATE', {
        resource: errors.resource,
        operation: errors.parseReceiptOperation,
        message: 'Handler returned an unknown bundle status.',
        context: { bundleStatus: String(rawStatus) },
      });
  }
}

export function mapBundleStateToInteropPhase(
  state: BundleLifecycleState,
  hasSourceTxHash = true,
): InteropPhase {
  switch (state) {
    case 'UNRECEIVED':
      return hasSourceTxHash ? 'SENT' : 'UNKNOWN';
    case 'VERIFIED':
      return 'VERIFIED';
    case 'FULLY_EXECUTED':
      return 'EXECUTED';
    case 'UNBUNDLED':
      return 'UNBUNDLED';
  }
}

export interface InspectBundleLifecycleInput {
  sourceTxHash?: Hex;
  bundleHash?: Hex;
  destinationTxHash?: Hex;
  getSourceReceipt(sourceTxHash: Hex): Promise<TxReceipt | null>;
  parseBundleSent(receipt: TxReceipt): { bundleHash: Hex };
  readBundleStatus(bundleHash: Hex): Promise<number | bigint>;
  findDestinationTxHash?(bundleHash: Hex, state: BundleLifecycleState): Promise<Hex | undefined>;
  errors?: BundleLifecycleErrors;
}

export interface BundleLifecycleInspection {
  sourceTxHash?: Hex;
  bundleHash?: Hex;
  destinationTxHash?: Hex;
  state: BundleLifecycleState;
}

export async function inspectBundleLifecycle(
  input: InspectBundleLifecycleInput,
): Promise<BundleLifecycleInspection> {
  let bundleHash = input.bundleHash;
  if (!bundleHash && input.sourceTxHash) {
    const receipt = await input.getSourceReceipt(input.sourceTxHash);
    if (receipt) bundleHash = input.parseBundleSent(receipt).bundleHash;
  }

  const state = bundleHash
    ? decodeBundleStatus(await input.readBundleStatus(bundleHash), input.errors)
    : 'UNRECEIVED';
  let destinationTxHash = input.destinationTxHash;
  if (
    !destinationTxHash &&
    bundleHash &&
    input.findDestinationTxHash &&
    (state === 'FULLY_EXECUTED' || state === 'UNBUNDLED')
  ) {
    destinationTxHash = await input.findDestinationTxHash(bundleHash, state);
  }

  return {
    sourceTxHash: input.sourceTxHash,
    bundleHash,
    destinationTxHash,
    state,
  };
}

export interface BundleLifecyclePollOptions {
  pollMs?: number;
  timeoutMs?: number;
}

export interface WaitForBundleLifecycleInput {
  sourceTxHash: Hex;
  expectedBundleHash?: Hex;
  getSourceReceipt(sourceTxHash: Hex): Promise<ReceiptWithL2ToL1 | null>;
  parseReceipt(receipt: ReceiptWithL2ToL1): BundleReceiptInfo;
  getFinalizedBlockNumber(): Promise<bigint | null>;
  getProof(sourceTxHash: Hex, logIndex: number): Promise<ProofNormalized>;
  isProofNotReadyError(error: unknown): boolean;
  destination?: {
    isReady(proof: ProofNormalized, finalizationInfo: InteropFinalizationInfo): Promise<boolean>;
    shouldRetryError?(error: unknown): boolean;
    timeoutMessage: string;
    timeoutContext?(proof: ProofNormalized): Record<string, unknown>;
  };
  options?: BundleLifecyclePollOptions;
  errors?: BundleLifecycleErrors;
  clock?: {
    now(): number;
    sleep(ms: number): Promise<void>;
  };
}

function timeoutError(
  errors: BundleLifecycleErrors,
  message: string,
  context: Record<string, unknown>,
) {
  return createError('TIMEOUT', {
    resource: errors.resource,
    operation: errors.timeoutOperation,
    message,
    context,
  });
}

export async function waitForBundleLifecycle(
  input: WaitForBundleLifecycleInput,
): Promise<InteropFinalizationInfo> {
  const errors = input.errors ?? INTEROP_BUNDLE_LIFECYCLE_ERRORS;
  const pollMs = input.options?.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = input.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = input.clock?.now ?? Date.now;
  const delay = input.clock?.sleep ?? sleep;
  const deadline = now() + timeoutMs;

  const assertWithinDeadline = (message: string, context: Record<string, unknown>) => {
    if (now() > deadline) throw timeoutError(errors, message, context);
  };

  let receipt: ReceiptWithL2ToL1 | null = null;
  while (!receipt) {
    assertWithinDeadline('Timed out waiting for source receipt to be available.', {
      sourceTxHash: input.sourceTxHash,
    });
    receipt = await input.getSourceReceipt(input.sourceTxHash);
    if (!receipt) await delay(pollMs);
  }

  const bundleInfo = input.parseReceipt(receipt);
  if (
    input.expectedBundleHash &&
    input.expectedBundleHash.toLowerCase() !== bundleInfo.bundleHash.toLowerCase()
  ) {
    throw createError('STATE', {
      resource: errors.resource,
      operation: errors.parseReceiptOperation,
      message: 'Provided bundle hash does not match the source receipt.',
      context: {
        expectedBundleHash: input.expectedBundleHash,
        emittedBundleHash: bundleInfo.bundleHash,
      },
    });
  }

  if (receipt.blockNumber == null) {
    throw createError('STATE', {
      resource: errors.resource,
      operation: errors.sourceReceiptOperation,
      message: 'Source receipt is missing the block number required for proof generation.',
      context: { sourceTxHash: input.sourceTxHash },
    });
  }
  const sourceBlockNumber = BigInt(receipt.blockNumber);

  while (true) {
    assertWithinDeadline('Timed out waiting for block to be finalized.', {
      sourceTxHash: input.sourceTxHash,
      logIndex: bundleInfo.l2ToL1LogIndex,
      blockNumber: sourceBlockNumber,
    });
    const finalizedBlockNumber = await input.getFinalizedBlockNumber();
    if (finalizedBlockNumber != null && finalizedBlockNumber >= sourceBlockNumber) break;
    await delay(pollMs);
  }

  let proof: ProofNormalized | undefined;
  while (!proof) {
    assertWithinDeadline('Timed out waiting for L2->L1 log proof to become available.', {
      sourceTxHash: input.sourceTxHash,
      logIndex: bundleInfo.l2ToL1LogIndex,
    });
    try {
      proof = await input.getProof(input.sourceTxHash, bundleInfo.l2ToL1LogIndex);
    } catch (error) {
      if (!input.isProofNotReadyError(error)) throw error;
    }
    if (!proof) await delay(pollMs);
  }

  const finalizationInfo = buildFinalizationInfo(
    { l2SrcTxHash: input.sourceTxHash, bundleHash: input.expectedBundleHash },
    bundleInfo,
    proof,
    bundleInfo.l1MessageData,
    errors,
  );

  if (!input.destination) return finalizationInfo;

  while (true) {
    assertWithinDeadline(
      input.destination.timeoutMessage,
      input.destination.timeoutContext?.(proof) ?? {
        bundleHash: finalizationInfo.bundleHash,
      },
    );
    try {
      if (await input.destination.isReady(proof, finalizationInfo)) return finalizationInfo;
    } catch (error) {
      if (!input.destination.shouldRetryError?.(error)) throw error;
    }
    await delay(pollMs);
  }
}
