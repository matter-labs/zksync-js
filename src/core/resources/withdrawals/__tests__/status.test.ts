// tests/withdrawals/status.test.ts
import { describe, it, expect } from 'bun:test';
import { TERMINAL_WITHDRAWAL_PHASES, isTerminalWithdrawalPhase } from '../status';

describe('withdrawals/isTerminalWithdrawalPhase', () => {
  it('treats FINALIZED and UNFINALIZABLE as terminal', () => {
    expect(isTerminalWithdrawalPhase('FINALIZED')).toBe(true);
    expect(isTerminalWithdrawalPhase('UNFINALIZABLE')).toBe(true);
  });

  it('treats every in-flight phase as non-terminal', () => {
    for (const phase of [
      'L2_PENDING',
      'L2_INCLUDED',
      'PENDING',
      'READY_TO_FINALIZE',
      'FINALIZING',
      'UNKNOWN',
    ] as const) {
      expect(isTerminalWithdrawalPhase(phase)).toBe(false);
    }
  });

  it('exposes the terminal set', () => {
    expect([...TERMINAL_WITHDRAWAL_PHASES]).toEqual(['FINALIZED', 'UNFINALIZABLE']);
  });
});
