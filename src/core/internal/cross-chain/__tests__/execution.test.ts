import { describe, expect, it } from 'bun:test';

import {
  executeSourcePlan,
  mergeSourceExecutionResults,
  type SourceExecutionDriver,
} from '../execution';
import type { Hex } from '../../../types/primitives';

const hash = (value: string) => `0x${value.padStart(64, '0')}` as Hex;

describe('cross-chain source execution', () => {
  it('allocates contiguous nonces and retains hashes and receipts', async () => {
    const seen: Array<[string, number]> = [];
    const driver: SourceExecutionDriver<object, { step: string }> = {
      resolveNonce: async (nonce) => {
        expect(nonce).toBe('pending');
        return 7;
      },
      executeStep: async ({ step, nonce }) => {
        seen.push([step.key, nonce]);
        return {
          kind: 'confirmed',
          hash: step.key === 'approve' ? hash('1') : hash('2'),
          receipt: { step: step.key },
        };
      },
    };
    const result = await executeSourcePlan({
      steps: [
        { key: 'approve', kind: 'approve', description: 'Approve', tx: {} },
        { key: 'send', kind: 'send', description: 'Send', tx: {} },
      ],
      nonce: 'pending',
      driver,
    });

    expect(seen).toEqual([
      ['approve', 7],
      ['send', 8],
    ]);
    expect(result.stepHashes).toEqual({ approve: hash('1'), send: hash('2') });
    expect([...result.receipts]).toEqual([
      ['approve', { step: 'approve' }],
      ['send', { step: 'send' }],
    ]);
    expect(result.lastSourceHash).toBe(hash('2'));
    expect(result.lastSourceReceipt).toEqual({ step: 'send' });
    expect(result.nextNonce).toBe(9);
  });

  it('does not consume a nonce for a skipped step', async () => {
    const seen: number[] = [];
    const result = await executeSourcePlan({
      steps: [
        { key: 'skip', kind: 'approve', description: 'Skip', tx: {} },
        { key: 'send', kind: 'send', description: 'Send', tx: {} },
      ],
      driver: {
        resolveNonce: async () => 3,
        executeStep: async ({ step, nonce }) => {
          seen.push(nonce);
          return step.key === 'skip'
            ? { kind: 'skipped' }
            : { kind: 'confirmed', hash: hash('3'), receipt: { status: 1 } };
        },
      },
    });

    expect(seen).toEqual([3, 3]);
    expect(result.stepHashes).toEqual({ send: hash('3') });
    expect(result.receipts.has('skip')).toBeFalse();
    expect(result.nextNonce).toBe(4);
  });

  it('supports empty phases and merges phased results', async () => {
    const empty = await executeSourcePlan({
      steps: [],
      nonce: 4,
      driver: {
        resolveNonce: async (nonce) => nonce as number,
        executeStep: async () => {
          throw new Error('unreachable');
        },
      },
    });
    const sent = await executeSourcePlan({
      steps: [{ key: 'send', kind: 'send', description: 'Send', tx: {} }],
      nonce: empty.nextNonce,
      driver: {
        resolveNonce: async (nonce) => nonce as number,
        executeStep: async () => ({
          kind: 'confirmed',
          hash: hash('4'),
          receipt: { status: 1 },
        }),
      },
    });
    const merged = mergeSourceExecutionResults(empty, sent);

    expect(merged.stepHashes).toEqual({ send: hash('4') });
    expect(merged.lastSourceReceipt).toEqual({ status: 1 });
    expect(merged.nextNonce).toBe(5);
  });

  it('rejects duplicate step keys before resolving a nonce or sending', async () => {
    let calls = 0;
    await expect(
      executeSourcePlan({
        steps: [
          { key: 'send', kind: 'send', description: 'First', tx: {} },
          { key: 'send', kind: 'send', description: 'Second', tx: {} },
        ],
        driver: {
          resolveNonce: async () => {
            calls += 1;
            return 0;
          },
          executeStep: async () => {
            calls += 1;
            return { kind: 'skipped' };
          },
        },
      }),
    ).rejects.toThrow(/Duplicate source step key/);
    expect(calls).toBe(0);
  });

  it('rejects duplicate keys while merging phases', () => {
    const result = {
      stepHashes: { send: hash('1') },
      receipts: new Map([['send', { status: 1 }]]),
      lastSourceHash: hash('1'),
      lastSourceReceipt: { status: 1 },
      nextNonce: 1,
    };
    expect(() => mergeSourceExecutionResults(result, result)).toThrow(/duplicate source step key/i);
  });

  it('stops immediately when a step fails', async () => {
    const seen: string[] = [];
    await expect(
      executeSourcePlan({
        steps: [
          { key: 'first', kind: 'send', description: 'First', tx: {} },
          { key: 'second', kind: 'send', description: 'Second', tx: {} },
        ],
        driver: {
          resolveNonce: async () => 1,
          executeStep: async ({ step }) => {
            seen.push(step.key);
            throw new Error('reverted');
          },
        },
      }),
    ).rejects.toThrow('reverted');
    expect(seen).toEqual(['first']);
  });
});
