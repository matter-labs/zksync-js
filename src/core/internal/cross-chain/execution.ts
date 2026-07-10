import type { PlanStep } from '../../types/flows/base';
import type { Hex } from '../../types/primitives';

export interface ExecutePlanStepContext<Tx> {
  step: PlanStep<Tx>;
  nonce: number;
}

export interface ExecutePlanInput<Tx> {
  steps: readonly PlanStep<Tx>[];
  initialNonce: number;
  executeStep(context: ExecutePlanStepContext<Tx>): Promise<Hex | null>;
}

export interface PlanExecutionResult {
  stepHashes: Record<string, Hex>;
  sourceTxHash?: Hex;
  nextNonce: number;
}

export async function executePlan<Tx>(input: ExecutePlanInput<Tx>): Promise<PlanExecutionResult> {
  const stepHashes: Record<string, Hex> = {};
  let nextNonce = input.initialNonce;
  let sourceTxHash: Hex | undefined;

  for (const step of input.steps) {
    const hash = await input.executeStep({ step, nonce: nextNonce });
    if (!hash) continue;

    stepHashes[step.key] = hash;
    sourceTxHash = hash;
    nextNonce += 1;
  }

  return { stepHashes, sourceTxHash, nextNonce };
}
