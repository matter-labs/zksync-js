// @ts-nocheck

import { describe, it, expect } from 'bun:test';
import { type Log } from 'ethers';
import {
  extractL2TxHashFromL1Logs,
  waitForL2ExecutionFromL1Tx,
  I_BRIDGEHUB,
  TOPIC_BRIDGEHUB_NPR,
} from '../verification';
import {
  TOPIC_CANONICAL_ASSIGNED,
  TOPIC_CANONICAL_SUCCESS,
} from '../../../../../../core/constants';
import { isZKsyncError } from '../../../../../../core/types/errors';

// Helpers
const H = {
  l1tx: '0x' + 'aa'.repeat(32),
  l2tx: '0x' + 'bb'.repeat(32),
  sender: '0x1111111111111111111111111111111111111111',
};

export function makeNprLog(args: {
  chainId?: bigint;
  sender?: string;
  txHash?: `0x${string}`;
  txId?: bigint;
  data?: `0x${string}`;
}): Log {
  const chainId = args.chainId ?? 324n;
  const sender = args.sender ?? H.sender;
  const txHash = args.txHash ?? (('0x' + '12'.repeat(32)) as `0x${string}`);
  const txId = args.txId ?? 1n;
  const data = args.data ?? ('0x' as `0x${string}`);

  const enc = I_BRIDGEHUB.encodeEventLog(TOPIC_BRIDGEHUB_NPR, [
    chainId,
    sender,
    txHash,
    txId,
    data,
  ]);
  return {
    address: '0x' + '00'.repeat(20),
    data: enc.data,
    topics: enc.topics,
    blockHash: '0x' + '00'.repeat(32),
    blockNumber: 1,
    index: 0,
    transactionHash: H.l1tx,
    transactionIndex: 0,
    removed: false,
  } as unknown as Log;
}

function makeTopicOnlyLog(topic0: string, extraTopics: string[] = []): Log {
  return {
    address: '0x' + '00'.repeat(20),
    data: '0x',
    topics: [topic0, ...extraTopics],
    blockHash: '0x' + '00'.repeat(32),
    blockNumber: 1,
    index: 0,
    transactionHash: H.l1tx,
    transactionIndex: 0,
    removed: false,
  } as unknown as Log;
}

describe('services/verification.extractL2TxHashFromL1Logs', () => {
  it('extracts from Bridgehub.NewPriorityRequest', () => {
    const target = H.l2tx as `0x${string}`;
    const log = makeNprLog({ txHash: target });
    const out = extractL2TxHashFromL1Logs([log]);
    expect(out).toBe(target);
  });

  it('falls back to TOPIC_CANONICAL_ASSIGNED (hash at topic[2])', () => {
    const assigned = makeTopicOnlyLog(TOPIC_CANONICAL_ASSIGNED, ['0x', H.l2tx, '0xdead']);
    const out = extractL2TxHashFromL1Logs([assigned]);
    expect(out).toBe(H.l2tx);
  });

  it('falls back to TOPIC_CANONICAL_SUCCESS (hash at topic[3])', () => {
    const success = makeTopicOnlyLog(TOPIC_CANONICAL_SUCCESS, ['0x1', '0x2', H.l2tx]);
    const out = extractL2TxHashFromL1Logs([success]);
    expect(out).toBe(H.l2tx);
  });

  it('ignores decode errors for NPR and still finds canonical topics', () => {
    const badNpr = {
      ...makeNprLog({}),
      data: '0x1234',
    } as Log;
    const success = makeTopicOnlyLog(TOPIC_CANONICAL_SUCCESS, ['0x1', '0x2', H.l2tx]);
    const out = extractL2TxHashFromL1Logs([badNpr, success]);
    expect(out).toBe(H.l2tx);
  });

  it('returns null when no recognizable logs exist', () => {
    const out = extractL2TxHashFromL1Logs([]);
    expect(out).toBeNull();
  });
});

// TODO: refactor with shared mocks
type FakeReceipt = { logs?: Log[]; status?: number };
function makeL1Provider(receipt: FakeReceipt | null) {
  return {
    async waitForTransaction(_hash: string) {
      return receipt as any;
    },
  } as any;
}
function makeL2Provider(opts: { wait: FakeReceipt | null; get?: FakeReceipt | null }) {
  return {
    async waitForTransaction(_hash: string) {
      return opts.wait as any;
    },
    async getTransactionReceipt(_hash: string) {
      if (opts.get instanceof Error) throw opts.get;
      return (opts.get ?? null) as any;
    },
  } as any;
}

describe('services/verification.waitForL2ExecutionFromL1Tx', () => {
  it('happy path: finds NPR hash on L1 and returns L2 receipt from wait', async () => {
    const l1Logs = [makeNprLog({ txHash: H.l2tx as `0x${string}` })];
    const l1 = makeL1Provider({ logs: l1Logs });
    const l2 = makeL2Provider({ wait: { status: 1 }, get: null });

    const out = await waitForL2ExecutionFromL1Tx(l1, l2, H.l1tx as `0x${string}`);
    expect(out.l2TxHash).toBe(H.l2tx);
    expect(out.l2Receipt.status).toBe(1);
  });

  it('fallback: L2 wait returns null; getTransactionReceipt returns success', async () => {
    const l1Logs = [makeNprLog({ txHash: H.l2tx as `0x${string}` })];
    const l1 = makeL1Provider({ logs: l1Logs });
    const l2 = makeL2Provider({ wait: null, get: { status: 1 } });

    const out = await waitForL2ExecutionFromL1Tx(l1, l2, H.l1tx as `0x${string}`);
    expect(out.l2TxHash).toBe(H.l2tx);
    expect(out.l2Receipt.status).toBe(1);
  });

  it('throws VERIFICATION error when L2 tx not found after waiting', async () => {
    const l1Logs = [makeNprLog({ txHash: H.l2tx as `0x${string}` })];
    const l1 = makeL1Provider({ logs: l1Logs });
    const l2 = makeL2Provider({ wait: null, get: null });

    let caught: unknown;
    try {
      await waitForL2ExecutionFromL1Tx(l1, l2, H.l1tx as `0x${string}`);
      expect('should have thrown').toBe('but did not');
    } catch (e) {
      caught = e;
    }
    expect(isZKsyncError(caught)).toBe(true);
    expect(String(caught)).toMatch(/was not found after waiting/);
  });

  it('throws VERIFICATION error when L2 tx execution failed (status !== 1)', async () => {
    const l1Logs = [makeNprLog({ txHash: H.l2tx as `0x${string}` })];
    const l1 = makeL1Provider({ logs: l1Logs });
    const l2 = makeL2Provider({ wait: null, get: { status: 0 } });

    let caught: unknown;
    try {
      await waitForL2ExecutionFromL1Tx(l1, l2, H.l1tx as `0x${string}`);
      expect('should have thrown').toBe('but did not');
    } catch (e) {
      caught = e;
    }
    expect(isZKsyncError(caught)).toBe(true);
    expect(String(caught)).toMatch(/execution failed/);
  });

  it('throws plain Error when L1 receipt is missing', async () => {
    const l1 = makeL1Provider(null);
    const l2 = makeL2Provider({ wait: null, get: null });

    let caught: unknown;
    try {
      await waitForL2ExecutionFromL1Tx(l1, l2, H.l1tx as `0x${string}`);
      expect('should have thrown').toBe('but did not');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/No L1 receipt found/);
  });

  it('extracts via canonical topics if NPR missing/corrupt', async () => {
    const badNpr = { ...makeNprLog({}), data: '0x1234' } as Log;
    const success = {
      ...makeTopicOnlyLog(TOPIC_CANONICAL_SUCCESS, ['0x1', '0x2', H.l2tx]),
    } as Log;

    const l1 = makeL1Provider({ logs: [badNpr, success] });
    const l2 = makeL2Provider({ wait: { status: 1 }, get: null });

    const out = await waitForL2ExecutionFromL1Tx(l1, l2, H.l1tx as `0x${string}`);
    expect(out.l2TxHash).toBe(H.l2tx);
  });
});
