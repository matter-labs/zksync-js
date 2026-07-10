import { describe, expect, it } from 'bun:test';
import type { InteropFinalizationInfo } from '../../../types/flows/interop';
import type { Hex } from '../../../types/primitives';
import {
  finalizeWithdrawalBundleLifecycle,
  inspectWithdrawalBundleLifecycle,
  pollWithdrawalStatus,
} from '../withdrawal-lifecycle';

const L2_TX_HASH = `0x${'11'.repeat(32)}` as Hex;
const BUNDLE_HASH = `0x${'22'.repeat(32)}` as Hex;
const L1_TX_HASH = `0x${'33'.repeat(32)}` as Hex;
const INFO = {
  l2SrcTxHash: L2_TX_HASH,
  bundleHash: BUNDLE_HASH,
  dstChainId: 1n,
  encodedData: '0xabcd',
  proof: {
    chainId: 324n,
    l1BatchNumber: 10n,
    l2MessageIndex: 3n,
    message: {
      txNumberInBatch: 2,
      sender: '0x4444444444444444444444444444444444444444',
      data: '0x01abcd',
    },
    proof: [`0x${'55'.repeat(32)}`],
  },
} as InteropFinalizationInfo;

describe('withdrawal intent bundle lifecycle', () => {
  it.each([
    ['UNRECEIVED', 'READY', 'READY_TO_FINALIZE'],
    ['VERIFIED', 'READY', 'READY_TO_FINALIZE'],
    ['FULLY_EXECUTED', 'READY', 'FINALIZED'],
    ['UNBUNDLED', 'READY', 'FINALIZE_FAILED'],
  ] as const)('maps %s with %s readiness to %s', async (state, readiness, phase) => {
    const status = await inspectWithdrawalBundleLifecycle({
      l2TxHash: L2_TX_HASH,
      isSourceIncluded: async () => true,
      getFinalizationInfo: async () => INFO,
      readBundleState: async () => state,
      simulate: async () => ({ kind: readiness }),
    });
    expect(status.phase).toBe(phase);
    expect(status.key?.bundleHash).toBe(BUNDLE_HASH);
  });

  it('maps source/proof pending and L1 execution states', async () => {
    const sourcePending = await inspectWithdrawalBundleLifecycle({
      l2TxHash: L2_TX_HASH,
      isSourceIncluded: async () => false,
      getFinalizationInfo: async () => INFO,
      readBundleState: async () => 'UNRECEIVED',
      simulate: async () => ({ kind: 'READY' }),
    });
    expect(sourcePending.phase).toBe('L2_PENDING');

    const proofPending = await inspectWithdrawalBundleLifecycle({
      l2TxHash: L2_TX_HASH,
      isSourceIncluded: async () => true,
      getFinalizationInfo: async () => {
        throw new Error('proof pending');
      },
      readBundleState: async () => 'UNRECEIVED',
      simulate: async () => ({ kind: 'READY' }),
    });
    expect(proofPending.phase).toBe('PENDING');

    const finalizing = await inspectWithdrawalBundleLifecycle({
      l2TxHash: L2_TX_HASH,
      isSourceIncluded: async () => true,
      getFinalizationInfo: async () => INFO,
      readBundleState: async () => 'VERIFIED',
      simulate: async () => ({ kind: 'READY' }),
      getExecutionState: async () => ({ txHash: L1_TX_HASH, state: 'pending' }),
    });
    expect(finalizing.phase).toBe('FINALIZING');
    expect(finalizing.l1FinalizeTxHash).toBe(L1_TX_HASH);
  });

  it('does not send on duplicate finalization', async () => {
    let sends = 0;
    const result = await finalizeWithdrawalBundleLifecycle({
      getFinalizationInfo: async () => INFO,
      readBundleState: async () => 'FULLY_EXECUTED',
      simulate: async () => ({ kind: 'READY' }),
      execute: async () => {
        sends += 1;
        return { hash: L1_TX_HASH, wait: async () => ({}) };
      },
    });
    expect(result.execution).toBeUndefined();
    expect(sends).toBe(0);
  });

  it('short-circuits an execution race that another caller finalized', async () => {
    let reads = 0;
    const result = await finalizeWithdrawalBundleLifecycle({
      getFinalizationInfo: async () => INFO,
      readBundleState: async () => (++reads === 1 ? 'VERIFIED' : 'FULLY_EXECUTED'),
      simulate: async () => ({ kind: 'READY' }),
      execute: async () => {
        throw new Error('already executed');
      },
    });
    expect(result.execution).toBeUndefined();
    expect(reads).toBe(2);
  });

  it('rejects paused and unbundled finalization without sending', async () => {
    await expect(
      finalizeWithdrawalBundleLifecycle({
        getFinalizationInfo: async () => INFO,
        readBundleState: async () => 'VERIFIED',
        simulate: async () => ({ kind: 'NOT_READY', reason: 'paused' }),
        execute: async () => ({ hash: L1_TX_HASH, wait: async () => ({}) }),
      }),
    ).rejects.toThrow(/not ready/);
    await expect(
      finalizeWithdrawalBundleLifecycle({
        getFinalizationInfo: async () => INFO,
        readBundleState: async () => 'UNBUNDLED',
        simulate: async () => ({ kind: 'READY' }),
        execute: async () => ({ hash: L1_TX_HASH, wait: async () => ({}) }),
      }),
    ).rejects.toThrow(/unbundled/);
  });

  it('polls status with deterministic timeout handling', async () => {
    let now = 0;
    let reads = 0;
    const result = await pollWithdrawalStatus({
      read: async () => ({
        phase: ++reads === 3 ? 'READY_TO_FINALIZE' : 'PENDING',
        l2TxHash: L2_TX_HASH,
      }),
      done: (status) => status.phase === 'READY_TO_FINALIZE',
      pollMs: 1,
      timeoutMs: 5,
      clock: {
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      },
    });
    expect(result?.phase).toBe('READY_TO_FINALIZE');

    const timeout = await pollWithdrawalStatus({
      read: async () => ({ phase: 'PENDING', l2TxHash: L2_TX_HASH }),
      done: () => false,
      pollMs: 1,
      timeoutMs: 1,
      clock: {
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      },
    });
    expect(timeout).toBeNull();
  });
});
