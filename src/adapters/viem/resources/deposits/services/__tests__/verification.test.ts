// @ts-nocheck

import { describe, it, expect } from 'bun:test';
import { encodeAbiParameters, encodeEventTopics, type AbiEvent, type Log } from 'viem';
import { getL2TransactionHashFromLogs, waitForL2ExecutionFromL1Tx } from '../verification';
import {
  TOPIC_CANONICAL_ASSIGNED,
  TOPIC_CANONICAL_SUCCESS,
} from '../../../../../../core/constants';
import { isZKsyncError } from '../../../../../../core/types/errors';

const NEW_PRIORITY_REQUEST_EVENT = {
  type: 'event',
  name: 'NewPriorityRequest',
  inputs: [
    { name: 'chainId', type: 'uint256', indexed: true },
    { name: 'sender', type: 'address', indexed: true },
    { name: 'txHash', type: 'bytes32', indexed: false },
    { name: 'txId', type: 'uint256', indexed: false },
    { name: 'data', type: 'bytes', indexed: false },
  ],
} as const satisfies AbiEvent;

// Helpers
const H = {
  l1tx: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
  l2tx: ('0x' + 'bb'.repeat(32)) as `0x${string}`,
  sender: '0x1111111111111111111111111111111111111111',
};

function makeNprLog(args: {
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

  const topics = encodeEventTopics({
    abi: [NEW_PRIORITY_REQUEST_EVENT],
    eventName: 'NewPriorityRequest',
    args: { chainId, sender },
  });
  const encodedData = encodeAbiParameters(
    [
      { name: 'txHash', type: 'bytes32' },
      { name: 'txId', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    [txHash, txId, data],
  );

  return {
    address: ('0x' + '00'.repeat(20)) as `0x${string}`,
    data: encodedData,
    topics,
    blockHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: H.l1tx,
    transactionIndex: 0,
    removed: false,
  } as unknown as Log;
}

function makeTopicOnlyLog(topic0: string, extraTopics: string[] = []): Log {
  return {
    address: ('0x' + '00'.repeat(20)) as `0x${string}`,
    data: '0x',
    topics: [topic0, ...extraTopics],
    blockHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: H.l1tx,
    transactionIndex: 0,
    removed: false,
  } as unknown as Log;
}

describe('services/verification.getL2TransactionHashFromLogs (viem)', () => {
  it('extracts from Bridgehub.NewPriorityRequest', () => {
    const target = H.l2tx as `0x${string}`;
    const log = makeNprLog({ txHash: target });
    const out = getL2TransactionHashFromLogs([log]);
    expect(out).toBe(target);
  });

  it('falls back to TOPIC_CANONICAL_ASSIGNED (hash at topic[2])', () => {
    const assigned = makeTopicOnlyLog(TOPIC_CANONICAL_ASSIGNED, ['0x', H.l2tx, '0xdead']);
    const out = getL2TransactionHashFromLogs([assigned]);
    expect(out).toBe(H.l2tx);
  });

  it('falls back to TOPIC_CANONICAL_SUCCESS (hash at topic[3])', () => {
    const success = makeTopicOnlyLog(TOPIC_CANONICAL_SUCCESS, ['0x1', '0x2', H.l2tx]);
    const out = getL2TransactionHashFromLogs([success]);
    expect(out).toBe(H.l2tx);
  });

  it('ignores decode errors for NPR and still finds canonical topics', () => {
    const badNpr = {
      ...makeNprLog({}),
      data: '0x1234',
    } as Log;
    const success = makeTopicOnlyLog(TOPIC_CANONICAL_SUCCESS, ['0x1', '0x2', H.l2tx]);
    const out = getL2TransactionHashFromLogs([badNpr, success]);
    expect(out).toBe(H.l2tx);
  });

  it('returns null when no recognizable logs exist', () => {
    const out = getL2TransactionHashFromLogs([]);
    expect(out).toBeNull();
  });
});

type FakeReceipt = { logs?: Log[]; status?: 'success' | 'reverted' };
function makeL1Provider(receipt: FakeReceipt | null) {
  return {
    async waitForTransactionReceipt(_args: { hash: `0x${string}` }) {
      return receipt as any;
    },
  } as any;
}
function makeL2Provider(opts: { wait: FakeReceipt | null; get?: FakeReceipt | null }) {
  return {
    async waitForTransactionReceipt(_args: { hash: `0x${string}` }) {
      return opts.wait as any;
    },
    async getTransactionReceipt(_args: { hash: `0x${string}` }) {
      if (opts.get instanceof Error) throw opts.get;
      return (opts.get ?? null) as any;
    },
  } as any;
}

describe('services/verification.waitForL2ExecutionFromL1Tx (viem)', () => {
  it('happy path: finds NPR hash on L1 and returns L2 receipt from wait', async () => {
    const l1Logs = [makeNprLog({ txHash: H.l2tx as `0x${string}` })];
    const l1 = makeL1Provider({ logs: l1Logs });
    const l2 = makeL2Provider({ wait: { status: 'success' }, get: null });

    const out = await waitForL2ExecutionFromL1Tx(l1, l2, H.l1tx as `0x${string}`);
    expect(out.l2TxHash).toBe(H.l2tx);
    expect(out.l2Receipt.status).toBe('success');
  });

  it('fallback: L2 wait returns null; getTransactionReceipt returns success', async () => {
    const l1Logs = [makeNprLog({ txHash: H.l2tx as `0x${string}` })];
    const l1 = makeL1Provider({ logs: l1Logs });
    const l2 = makeL2Provider({ wait: null, get: { status: 'success' } });

    const out = await waitForL2ExecutionFromL1Tx(l1, l2, H.l1tx as `0x${string}`);
    expect(out.l2TxHash).toBe(H.l2tx);
    expect(out.l2Receipt.status).toBe('success');
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

  it('throws VERIFICATION error when L2 tx execution failed', async () => {
    const l1Logs = [makeNprLog({ txHash: H.l2tx as `0x${string}` })];
    const l1 = makeL1Provider({ logs: l1Logs });
    const l2 = makeL2Provider({ wait: null, get: { status: 'reverted' } });

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
    const l2 = makeL2Provider({ wait: { status: 'success' }, get: null });

    const out = await waitForL2ExecutionFromL1Tx(l1, l2, H.l1tx as `0x${string}`);
    expect(out.l2TxHash).toBe(H.l2tx);
  });
});
