import type { PlanStep } from '../../types/flows/base';
import type { TxOverrides } from '../../types/fees';
import type { Hex } from '../../types/primitives';

export type SourceStepOutcome<Receipt> =
  | { kind: 'skipped' }
  | { kind: 'confirmed'; hash: Hex; receipt: Receipt };

export interface SourceExecutionStepContext<Tx> {
  step: PlanStep<Tx>;
  nonce: number;
}

export interface SourceExecutionDriver<Tx, Receipt> {
  resolveNonce(nonce?: TxOverrides['nonce']): Promise<number>;
  executeStep(context: SourceExecutionStepContext<Tx>): Promise<SourceStepOutcome<Receipt>>;
}

export interface ExecuteSourcePlanInput<Tx, Receipt> {
  steps: readonly PlanStep<Tx>[];
  nonce?: TxOverrides['nonce'];
  driver: SourceExecutionDriver<Tx, Receipt>;
}

export interface SourceExecutionResult<Receipt> {
  stepHashes: Record<string, Hex>;
  receipts: Map<string, Receipt>;
  lastSourceHash?: Hex;
  lastSourceReceipt?: Receipt;
  nextNonce: number;
}

/** Orchestrates opaque adapter requests without inspecting their encoded transaction data. */
export async function executeSourcePlan<Tx, Receipt>(
  input: ExecuteSourcePlanInput<Tx, Receipt>,
): Promise<SourceExecutionResult<Receipt>> {
  assertUniqueStepKeys(input.steps);

  const stepHashes: Record<string, Hex> = {};
  const receipts = new Map<string, Receipt>();
  let nextNonce = await input.driver.resolveNonce(input.nonce);
  let lastSourceHash: Hex | undefined;
  let lastSourceReceipt: Receipt | undefined;

  for (const step of input.steps) {
    const outcome = await input.driver.executeStep({ step, nonce: nextNonce });
    if (outcome.kind === 'skipped') continue;

    stepHashes[step.key] = outcome.hash;
    receipts.set(step.key, outcome.receipt);
    lastSourceHash = outcome.hash;
    lastSourceReceipt = outcome.receipt;
    nextNonce += 1;
  }

  return { stepHashes, receipts, lastSourceHash, lastSourceReceipt, nextNonce };
}

export function mergeSourceExecutionResults<Receipt>(
  first: SourceExecutionResult<Receipt>,
  ...rest: readonly SourceExecutionResult<Receipt>[]
): SourceExecutionResult<Receipt> {
  const stepHashes = { ...first.stepHashes };
  const receipts = new Map(first.receipts);
  let lastSourceHash = first.lastSourceHash;
  let lastSourceReceipt = first.lastSourceReceipt;
  let nextNonce = first.nextNonce;

  for (const result of rest) {
    const resultKeys = new Set([...Object.keys(result.stepHashes), ...result.receipts.keys()]);
    const duplicateKey = [...resultKeys].find(
      (stepKey) =>
        Object.prototype.hasOwnProperty.call(stepHashes, stepKey) || receipts.has(stepKey),
    );
    if (duplicateKey !== undefined) {
      throw new Error(`Cannot merge duplicate source step key: ${duplicateKey}.`);
    }
    Object.assign(stepHashes, result.stepHashes);
    for (const [stepKey, receipt] of result.receipts) {
      receipts.set(stepKey, receipt);
    }
    lastSourceReceipt =
      result.lastSourceHash == null ? lastSourceReceipt : result.lastSourceReceipt;
    lastSourceHash = result.lastSourceHash ?? lastSourceHash;
    nextNonce = result.nextNonce;
  }

  return { stepHashes, receipts, lastSourceHash, lastSourceReceipt, nextNonce };
}

function assertUniqueStepKeys<Tx>(steps: readonly PlanStep<Tx>[]): void {
  const keys = new Set<string>();
  for (const step of steps) {
    if (keys.has(step.key)) throw new Error(`Duplicate source step key: ${step.key}.`);
    keys.add(step.key);
  }
}
