import { describe, it, expect } from 'bun:test';
import { phaseFromReadiness } from '../status';

describe('withdrawals/phaseFromReadiness', () => {
  it('maps READY to READY_TO_FINALIZE', () => {
    expect(phaseFromReadiness({ kind: 'READY' })).toEqual({ phase: 'READY_TO_FINALIZE' });
  });

  it('maps FINALIZED to FINALIZED', () => {
    expect(phaseFromReadiness({ kind: 'FINALIZED' })).toEqual({ phase: 'FINALIZED' });
  });

  it('maps NOT_READY to PENDING and carries the reason', () => {
    expect(phaseFromReadiness({ kind: 'NOT_READY', reason: 'batch-not-executed' })).toEqual({
      phase: 'PENDING',
      reason: 'batch-not-executed',
    });
  });

  it('maps UNFINALIZABLE to UNFINALIZABLE, not PENDING', () => {
    const out = phaseFromReadiness({ kind: 'UNFINALIZABLE', reason: 'message-invalid' });
    expect(out.phase).toBe('UNFINALIZABLE');
    expect(out.phase).not.toBe('PENDING');
    expect(out.reason).toBe('message-invalid');
  });

  it('appends detail to the reason when present', () => {
    expect(
      phaseFromReadiness({
        kind: 'UNFINALIZABLE',
        reason: 'unsupported',
        detail: 'WrongL2Sender',
      }),
    ).toEqual({ phase: 'UNFINALIZABLE', reason: 'unsupported: WrongL2Sender' });
  });

  it('distinguishes every transient reason from every permanent one', () => {
    const transient = (['paused', 'batch-not-executed', 'root-missing', 'unknown'] as const).map(
      (reason) => phaseFromReadiness({ kind: 'NOT_READY', reason }).phase,
    );
    const permanent = (
      ['message-invalid', 'invalid-chain', 'settlement-layer', 'unsupported'] as const
    ).map((reason) => phaseFromReadiness({ kind: 'UNFINALIZABLE', reason }).phase);

    expect(new Set(transient)).toEqual(new Set(['PENDING']));
    expect(new Set(permanent)).toEqual(new Set(['UNFINALIZABLE']));
  });
});
