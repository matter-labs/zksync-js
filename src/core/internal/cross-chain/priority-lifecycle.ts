import { createError } from '../../errors/factory';
import type { DepositPhase } from '../../types/flows/deposits';
import type { Resource } from '../../types/errors';
import type { Hex } from '../../types/primitives';

export type PriorityLifecycleState =
  | 'SOURCE_PENDING'
  | 'SOURCE_INCLUDED'
  | 'DESTINATION_PENDING'
  | 'DESTINATION_EXECUTED'
  | 'DESTINATION_FAILED';

export interface PriorityLifecycleErrors {
  resource: Extract<Resource, 'deposits'>;
  waitOperation: string;
  sourceLabel: string;
  destinationLabel: string;
}

export const DEPOSIT_PRIORITY_LIFECYCLE_ERRORS: PriorityLifecycleErrors = {
  resource: 'deposits',
  waitOperation: 'deposits.wait',
  sourceLabel: 'L1',
  destinationLabel: 'L2',
};

export interface InspectPriorityLifecycleInput<SourceReceipt, DestinationReceipt> {
  sourceTxHash: Hex;
  getSourceReceipt(sourceTxHash: Hex): Promise<SourceReceipt | null>;
  deriveDestinationTxHash(sourceReceipt: SourceReceipt): Hex | null;
  getDestinationReceipt(destinationTxHash: Hex): Promise<DestinationReceipt | null>;
  isDestinationReceiptNotFoundError(error: unknown): boolean;
  isDestinationReceiptSuccessful(receipt: DestinationReceipt): boolean;
}

export interface PriorityLifecycleInspection<SourceReceipt, DestinationReceipt> {
  state: PriorityLifecycleState;
  sourceTxHash: Hex;
  destinationTxHash?: Hex;
  sourceReceipt?: SourceReceipt;
  destinationReceipt?: DestinationReceipt;
}

export async function inspectPriorityLifecycle<SourceReceipt, DestinationReceipt>(
  input: InspectPriorityLifecycleInput<SourceReceipt, DestinationReceipt>,
): Promise<PriorityLifecycleInspection<SourceReceipt, DestinationReceipt>> {
  const sourceReceipt = await input.getSourceReceipt(input.sourceTxHash);
  if (!sourceReceipt) {
    return { state: 'SOURCE_PENDING', sourceTxHash: input.sourceTxHash };
  }

  const destinationTxHash = input.deriveDestinationTxHash(sourceReceipt);
  if (!destinationTxHash) {
    return {
      state: 'SOURCE_INCLUDED',
      sourceTxHash: input.sourceTxHash,
      sourceReceipt,
    };
  }

  let destinationReceipt: DestinationReceipt | null;
  try {
    destinationReceipt = await input.getDestinationReceipt(destinationTxHash);
  } catch (error) {
    if (!input.isDestinationReceiptNotFoundError(error)) throw error;
    destinationReceipt = null;
  }

  if (!destinationReceipt) {
    return {
      state: 'DESTINATION_PENDING',
      sourceTxHash: input.sourceTxHash,
      destinationTxHash,
      sourceReceipt,
    };
  }

  return {
    state: input.isDestinationReceiptSuccessful(destinationReceipt)
      ? 'DESTINATION_EXECUTED'
      : 'DESTINATION_FAILED',
    sourceTxHash: input.sourceTxHash,
    destinationTxHash,
    sourceReceipt,
    destinationReceipt,
  };
}

export function mapPriorityStateToDepositPhase(state: PriorityLifecycleState): DepositPhase {
  switch (state) {
    case 'SOURCE_PENDING':
      return 'L1_PENDING';
    case 'SOURCE_INCLUDED':
      return 'L1_INCLUDED';
    case 'DESTINATION_PENDING':
      return 'L2_PENDING';
    case 'DESTINATION_EXECUTED':
      return 'L2_EXECUTED';
    case 'DESTINATION_FAILED':
      return 'L2_FAILED';
  }
}

export interface WaitForPriorityLifecycleInput<SourceReceipt, DestinationReceipt> {
  sourceTxHash: Hex;
  target: 'source' | 'destination';
  waitForSourceReceipt(sourceTxHash: Hex): Promise<SourceReceipt | null>;
  deriveDestinationTxHash(sourceReceipt: SourceReceipt): Hex | null;
  waitForDestinationReceipt(destinationTxHash: Hex): Promise<DestinationReceipt | null>;
  getDestinationReceipt(destinationTxHash: Hex): Promise<DestinationReceipt | null>;
  isDestinationReceiptSuccessful(receipt: DestinationReceipt): boolean;
  errors?: PriorityLifecycleErrors;
}

export interface PriorityLifecycleWaitResult<SourceReceipt, DestinationReceipt> {
  sourceTxHash: Hex;
  destinationTxHash?: Hex;
  sourceReceipt: SourceReceipt | null;
  destinationReceipt?: DestinationReceipt;
}

export async function waitForPriorityLifecycle<SourceReceipt, DestinationReceipt>(
  input: WaitForPriorityLifecycleInput<SourceReceipt, DestinationReceipt>,
): Promise<PriorityLifecycleWaitResult<SourceReceipt, DestinationReceipt>> {
  const errors = input.errors ?? DEPOSIT_PRIORITY_LIFECYCLE_ERRORS;
  const sourceReceipt = await input.waitForSourceReceipt(input.sourceTxHash);
  if (!sourceReceipt || input.target === 'source') {
    return { sourceTxHash: input.sourceTxHash, sourceReceipt };
  }

  const destinationTxHash = input.deriveDestinationTxHash(sourceReceipt);
  if (!destinationTxHash) {
    throw createError('VERIFICATION', {
      resource: errors.resource,
      operation: errors.waitOperation,
      message: `Failed to extract ${errors.destinationLabel} transaction hash from ${errors.sourceLabel} logs`,
      context: { sourceTxHash: input.sourceTxHash },
    });
  }

  let destinationReceipt = await input.waitForDestinationReceipt(destinationTxHash);
  if (!destinationReceipt) {
    destinationReceipt = await input.getDestinationReceipt(destinationTxHash);
  }
  if (!destinationReceipt) {
    throw createError('VERIFICATION', {
      resource: errors.resource,
      operation: errors.waitOperation,
      message: `${errors.destinationLabel} transaction was not found after waiting for its execution`,
      context: { sourceTxHash: input.sourceTxHash, destinationTxHash },
    });
  }

  if (!input.isDestinationReceiptSuccessful(destinationReceipt)) {
    throw createError('VERIFICATION', {
      resource: errors.resource,
      operation: errors.waitOperation,
      message: `${errors.destinationLabel} transaction execution failed`,
      context: { sourceTxHash: input.sourceTxHash, destinationTxHash },
    });
  }

  return {
    sourceTxHash: input.sourceTxHash,
    destinationTxHash,
    sourceReceipt,
    destinationReceipt,
  };
}
