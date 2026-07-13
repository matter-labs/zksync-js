/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'bun:test';
import type { ProofNormalized, ReceiptWithL2ToL1 } from '../../../rpc/types';
import type { Hex } from '../../../types/primitives';
import {
  decodeBundleStatus,
  inspectBundleLifecycle,
  mapBundleStateToInteropPhase,
  waitForBundleLifecycle,
  type BundleReceiptInfo,
  type WaitForBundleLifecycleInput,
} from '../bundle-lifecycle';

const SOURCE_TX_HASH = `0x${'11'.repeat(32)}` as Hex;
const BUNDLE_HASH = `0x${'22'.repeat(32)}` as Hex;
const OTHER_BUNDLE_HASH = `0x${'33'.repeat(32)}` as Hex;
const DESTINATION_TX_HASH = `0x${'44'.repeat(32)}` as Hex;

const RECEIPT = {
  blockNumber: 5,
  transactionIndex: '0x2',
  logs: [],
} as unknown as ReceiptWithL2ToL1;

const BUNDLE_INFO: BundleReceiptInfo = {
  bundleHash: BUNDLE_HASH,
  dstChainId: 9n,
  sourceChainId: 8n,
  l1MessageData: '0x01abcd',
  l2ToL1LogIndex: 3,
  txNumberInBatch: 2,
  rawReceipt: RECEIPT,
};

const PROOF: ProofNormalized = {
  id: 7n,
  batchNumber: 6n,
  proof: [`0x${'55'.repeat(32)}`],
  root: `0x${'66'.repeat(32)}`,
};

function createClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

function createWaitInput(
  overrides: Partial<WaitForBundleLifecycleInput> = {},
): WaitForBundleLifecycleInput {
  return {
    sourceTxHash: SOURCE_TX_HASH,
    expectedBundleHash: BUNDLE_HASH,
    options: { pollMs: 1, timeoutMs: 10 },
    clock: createClock(),
    getSourceReceipt: async () => RECEIPT,
    parseReceipt: () => BUNDLE_INFO,
    getFinalizedBlockNumber: async () => 5n,
    getProof: async () => PROOF,
    isProofNotReadyError: () => false,
    ...overrides,
  };
}

describe('cross-chain bundle lifecycle', () => {
  it('owns receipt, finality, proof, and destination readiness polling', async () => {
    let receiptCalls = 0;
    let finalizedCalls = 0;
    let proofCalls = 0;
    let destinationCalls = 0;
    const notReady = new Error('proof not ready');

    const info = await waitForBundleLifecycle(
      createWaitInput({
        getSourceReceipt: async () => (++receiptCalls === 1 ? null : RECEIPT),
        getFinalizedBlockNumber: async () => (++finalizedCalls === 1 ? 4n : 5n),
        getProof: async () => {
          if (++proofCalls === 1) throw notReady;
          return PROOF;
        },
        isProofNotReadyError: (error) => error === notReady,
        destination: {
          timeoutMessage: 'Timed out waiting for destination.',
          isReady: async () => ++destinationCalls === 2,
        },
      }),
    );

    expect(receiptCalls).toBe(2);
    expect(finalizedCalls).toBe(2);
    expect(proofCalls).toBe(2);
    expect(destinationCalls).toBe(2);
    expect(info).toEqual({
      l2SrcTxHash: SOURCE_TX_HASH,
      bundleHash: BUNDLE_HASH,
      dstChainId: 9n,
      encodedData: '0xabcd',
      proof: {
        chainId: 8n,
        l1BatchNumber: 6n,
        l2MessageIndex: 7n,
        message: {
          txNumberInBatch: 2,
          sender: '0x000000000000000000000000000000000001000d',
          data: '0x01abcd',
        },
        proof: PROOF.proof,
      },
    });
  });

  it.each([
    {
      stage: 'source receipt',
      override: { getSourceReceipt: async () => null },
      expected: 'Timed out waiting for source receipt',
    },
    {
      stage: 'source finality',
      override: { getFinalizedBlockNumber: async () => 4n },
      expected: 'Timed out waiting for block to be finalized',
    },
    {
      stage: 'message proof',
      override: {
        getProof: async () => {
          throw new Error('not ready');
        },
        isProofNotReadyError: () => true,
      },
      expected: 'Timed out waiting for L2->L1 log proof',
    },
    {
      stage: 'destination readiness',
      override: {
        destination: {
          timeoutMessage: 'Timed out waiting for destination readiness.',
          isReady: async () => false,
        },
      },
      expected: 'Timed out waiting for destination readiness',
    },
  ])('times out during $stage', async ({ override, expected }) => {
    await expect(
      waitForBundleLifecycle(
        createWaitInput({
          options: { pollMs: 1, timeoutMs: 2 },
          ...(override as Partial<WaitForBundleLifecycleInput>),
        }),
      ),
    ).rejects.toThrow(expected);
  });

  it('does not retry unrelated proof failures', async () => {
    const failure = new Error('RPC unavailable');
    await expect(
      waitForBundleLifecycle(
        createWaitInput({
          getProof: async () => {
            throw failure;
          },
        }),
      ),
    ).rejects.toBe(failure);
  });

  it('retries configured destination read failures', async () => {
    const retryable = new Error('root not propagated');
    let calls = 0;
    const info = await waitForBundleLifecycle(
      createWaitInput({
        destination: {
          timeoutMessage: 'Timed out waiting for root.',
          shouldRetryError: (error) => error === retryable,
          isReady: async () => {
            if (++calls === 1) throw retryable;
            return true;
          },
        },
      }),
    );
    expect(calls).toBe(2);
    expect(info.bundleHash).toBe(BUNDLE_HASH);
  });

  it('rejects receipts without a block number', async () => {
    await expect(
      waitForBundleLifecycle(
        createWaitInput({
          getSourceReceipt: async () => ({ ...RECEIPT, blockNumber: undefined }),
        }),
      ),
    ).rejects.toThrow(/missing the block number/);
  });

  it('rejects a cached bundle hash that differs from the emitted bundle', async () => {
    await expect(
      waitForBundleLifecycle(
        createWaitInput({
          expectedBundleHash: OTHER_BUNDLE_HASH,
        }),
      ),
    ).rejects.toThrow(/does not match the source receipt/);
  });

  it.each([
    [0, 'UNRECEIVED', 'SENT'],
    [1, 'VERIFIED', 'VERIFIED'],
    [2, 'FULLY_EXECUTED', 'EXECUTED'],
    [3, 'UNBUNDLED', 'UNBUNDLED'],
  ] as const)('maps handler status %s through the intent phase', (raw, state, phase) => {
    expect(decodeBundleStatus(raw)).toBe(state);
    expect(mapBundleStateToInteropPhase(state)).toBe(phase);
  });

  it('rejects unknown handler status values', () => {
    expect(() => decodeBundleStatus(4)).toThrow(/unknown bundle status/);
  });

  it('derives the emitted bundle and looks up a final execution hash once', async () => {
    let destinationLookupCalls = 0;
    const inspection = await inspectBundleLifecycle({
      sourceTxHash: SOURCE_TX_HASH,
      getSourceReceipt: async () => ({ logs: [] }),
      parseBundleSent: () => ({ bundleHash: BUNDLE_HASH }),
      readBundleStatus: async () => 2,
      findDestinationTxHash: async () => {
        destinationLookupCalls += 1;
        return DESTINATION_TX_HASH;
      },
    });

    expect(inspection).toEqual({
      sourceTxHash: SOURCE_TX_HASH,
      bundleHash: BUNDLE_HASH,
      destinationTxHash: DESTINATION_TX_HASH,
      state: 'FULLY_EXECUTED',
    });
    expect(destinationLookupCalls).toBe(1);
  });

  it('does not query a handler until a bundle hash can be resolved', async () => {
    let statusCalls = 0;
    const inspection = await inspectBundleLifecycle({
      sourceTxHash: SOURCE_TX_HASH,
      getSourceReceipt: async () => null,
      parseBundleSent: () => ({ bundleHash: BUNDLE_HASH }),
      readBundleStatus: async () => {
        statusCalls += 1;
        return 0;
      },
    });

    expect(inspection.state).toBe('UNRECEIVED');
    expect(statusCalls).toBe(0);
  });
});
