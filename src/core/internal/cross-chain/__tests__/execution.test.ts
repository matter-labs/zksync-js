import { describe, expect, it } from 'bun:test';

import { executePlan } from '../execution';
import type { Hex } from '../../../types/primitives';

const hash = (value: string) => `0x${value.padStart(64, '0')}` as Hex;

describe('cross-chain plan execution', () => {
  it('allocates contiguous nonces and returns the final source hash', async () => {
    const seen: Array<[string, number]> = [];
    const result = await executePlan({
      steps: [
        { key: 'approve', kind: 'approve', description: 'Approve', tx: {} },
        { key: 'send', kind: 'send', description: 'Send', tx: {} },
      ],
      initialNonce: 7,
      async executeStep({ step, nonce }) {
        seen.push([step.key, nonce]);
        return step.key === 'approve' ? hash('1') : hash('2');
      },
    });

    expect(seen).toEqual([
      ['approve', 7],
      ['send', 8],
    ]);
    expect(result.stepHashes).toEqual({ approve: hash('1'), send: hash('2') });
    expect(result.sourceTxHash).toBe(hash('2'));
    expect(result.nextNonce).toBe(9);
  });

  it('does not consume a nonce for a skipped step', async () => {
    const seen: number[] = [];
    const result = await executePlan({
      steps: [
        { key: 'skip', kind: 'approve', description: 'Skip', tx: {} },
        { key: 'send', kind: 'send', description: 'Send', tx: {} },
      ],
      initialNonce: 3,
      async executeStep({ step, nonce }) {
        seen.push(nonce);
        return step.key === 'skip' ? null : hash('3');
      },
    });

    expect(seen).toEqual([3, 3]);
    expect(result.stepHashes).toEqual({ send: hash('3') });
    expect(result.nextNonce).toBe(4);
  });

  it('stops immediately when a step fails', async () => {
    const seen: string[] = [];

    await expect(
      executePlan({
        steps: [
          { key: 'first', kind: 'send', description: 'First', tx: {} },
          { key: 'second', kind: 'send', description: 'Second', tx: {} },
        ],
        initialNonce: 1,
        async executeStep({ step }) {
          seen.push(step.key);
          throw new Error('reverted');
        },
      }),
    ).rejects.toThrow('reverted');

    expect(seen).toEqual(['first']);
  });
});
