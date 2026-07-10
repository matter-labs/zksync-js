import type { InteropFinalizationInfo } from '../../types/flows/interop';
import type { FinalizeReadiness, WithdrawalStatus } from '../../types/flows/withdrawals';
import type { Hex } from '../../types/primitives';
import { createError } from '../../errors/factory';
import { OP_WITHDRAWALS } from '../../types/errors';
import { sleep } from '../../utils';
import type { BundleLifecycleState } from './bundle-lifecycle';

export interface WithdrawalExecutionState {
  txHash: Hex;
  state: 'pending' | 'success' | 'failed';
}

export interface InspectWithdrawalBundleLifecycleInput {
  l2TxHash: Hex;
  isSourceIncluded(): Promise<boolean>;
  getFinalizationInfo(): Promise<InteropFinalizationInfo>;
  readBundleState(bundleHash: Hex): Promise<BundleLifecycleState>;
  simulate(info: InteropFinalizationInfo): Promise<FinalizeReadiness>;
  getExecutionState?(): Promise<WithdrawalExecutionState | undefined>;
}

function statusWithInfo(
  phase: WithdrawalStatus['phase'],
  l2TxHash: Hex,
  info: InteropFinalizationInfo,
  execution?: WithdrawalExecutionState,
): WithdrawalStatus {
  return {
    phase,
    l2TxHash,
    l1FinalizeTxHash: execution?.txHash,
    key: {
      bundleHash: info.bundleHash,
      chainIdL2: info.proof.chainId,
      l2BatchNumber: info.proof.l1BatchNumber,
      l2MessageIndex: info.proof.l2MessageIndex,
    },
  };
}

export async function inspectWithdrawalBundleLifecycle(
  input: InspectWithdrawalBundleLifecycleInput,
): Promise<WithdrawalStatus> {
  if (!(await input.isSourceIncluded())) {
    return { phase: 'L2_PENDING', l2TxHash: input.l2TxHash };
  }

  let info: InteropFinalizationInfo;
  try {
    info = await input.getFinalizationInfo();
  } catch {
    return { phase: 'PENDING', l2TxHash: input.l2TxHash };
  }

  let state: BundleLifecycleState;
  try {
    state = await input.readBundleState(info.bundleHash);
  } catch {
    return statusWithInfo('PENDING', input.l2TxHash, info);
  }

  const execution = await input.getExecutionState?.();
  if (state === 'FULLY_EXECUTED') {
    return statusWithInfo('FINALIZED', input.l2TxHash, info, execution);
  }
  if (state === 'UNBUNDLED' || execution?.state === 'failed') {
    return statusWithInfo('FINALIZE_FAILED', input.l2TxHash, info, execution);
  }
  if (execution?.state === 'pending') {
    return statusWithInfo('FINALIZING', input.l2TxHash, info, execution);
  }

  let readiness: FinalizeReadiness;
  try {
    readiness = await input.simulate(info);
  } catch {
    return statusWithInfo('PENDING', input.l2TxHash, info, execution);
  }

  switch (readiness.kind) {
    case 'FINALIZED':
      return statusWithInfo('FINALIZED', input.l2TxHash, info, execution);
    case 'READY':
      return statusWithInfo('READY_TO_FINALIZE', input.l2TxHash, info, execution);
    case 'UNFINALIZABLE':
      return statusWithInfo('FINALIZE_FAILED', input.l2TxHash, info, execution);
    case 'NOT_READY':
      return statusWithInfo('PENDING', input.l2TxHash, info, execution);
  }
}

export interface FinalizeWithdrawalBundleLifecycleInput<Receipt> {
  getFinalizationInfo(): Promise<InteropFinalizationInfo>;
  readBundleState(bundleHash: Hex): Promise<BundleLifecycleState>;
  simulate(info: InteropFinalizationInfo): Promise<FinalizeReadiness>;
  execute(info: InteropFinalizationInfo): Promise<{ hash: Hex; wait(): Promise<Receipt> }>;
}

export interface FinalizeWithdrawalBundleLifecycleResult<Receipt> {
  info: InteropFinalizationInfo;
  execution?: { hash: Hex; receipt: Receipt };
}

export async function finalizeWithdrawalBundleLifecycle<Receipt>(
  input: FinalizeWithdrawalBundleLifecycleInput<Receipt>,
): Promise<FinalizeWithdrawalBundleLifecycleResult<Receipt>> {
  const info = await input.getFinalizationInfo();
  const state = await input.readBundleState(info.bundleHash);
  if (state === 'FULLY_EXECUTED') return { info };
  if (state === 'UNBUNDLED') {
    throw createError('STATE', {
      resource: 'withdrawals',
      operation: OP_WITHDRAWALS.finalize.readiness.simulate,
      message: 'Withdrawal bundle was unbundled and cannot be finalized atomically.',
      context: { bundleHash: info.bundleHash },
    });
  }

  const readiness = await input.simulate(info);
  if (readiness.kind === 'FINALIZED') return { info };
  if (readiness.kind !== 'READY') {
    throw createError('STATE', {
      resource: 'withdrawals',
      operation: OP_WITHDRAWALS.finalize.readiness.simulate,
      message:
        readiness.kind === 'NOT_READY'
          ? 'Withdrawal not ready to finalize.'
          : 'Withdrawal cannot be finalized.',
      context: { bundleHash: info.bundleHash, ...readiness },
    });
  }

  try {
    const tx = await input.execute(info);
    return {
      info,
      execution: { hash: tx.hash, receipt: await tx.wait() },
    };
  } catch (error) {
    try {
      if ((await input.readBundleState(info.bundleHash)) === 'FULLY_EXECUTED') return { info };
    } catch {
      // Preserve the original execution error when the race check also fails.
    }
    throw error;
  }
}

export interface PollWithdrawalStatusInput {
  read(): Promise<WithdrawalStatus>;
  done(status: WithdrawalStatus): boolean;
  pollMs: number;
  timeoutMs?: number;
  clock?: {
    now(): number;
    sleep(ms: number): Promise<void>;
  };
}

export async function pollWithdrawalStatus(
  input: PollWithdrawalStatusInput,
): Promise<WithdrawalStatus | null> {
  const now = input.clock?.now ?? Date.now;
  const delay = input.clock?.sleep ?? sleep;
  const deadline = input.timeoutMs == null ? undefined : now() + input.timeoutMs;

  while (true) {
    const status = await input.read();
    if (input.done(status)) return status;
    if (deadline != null && now() > deadline) return null;
    await delay(input.pollMs);
  }
}
