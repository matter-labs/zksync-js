import { describe, expect, it } from 'bun:test';
import type { Hex } from '../../../types/primitives';
import {
  inspectPriorityLifecycle,
  mapPriorityStateToDepositPhase,
  waitForPriorityLifecycle,
} from '../priority-lifecycle';

const SOURCE_TX_HASH = `0x${'11'.repeat(32)}` as Hex;
const DESTINATION_TX_HASH = `0x${'22'.repeat(32)}` as Hex;

describe('cross-chain priority lifecycle', () => {
  it.each([
    ['SOURCE_PENDING', 'L1_PENDING'],
    ['SOURCE_INCLUDED', 'L1_INCLUDED'],
    ['DESTINATION_PENDING', 'L2_PENDING'],
    ['DESTINATION_EXECUTED', 'L2_EXECUTED'],
    ['DESTINATION_FAILED', 'L2_FAILED'],
  ] as const)('maps %s to the deposit intent phase', (state, phase) => {
    expect(mapPriorityStateToDepositPhase(state)).toBe(phase);
  });

  it('sequences source/hash/destination inspection', async () => {
    const inspection = await inspectPriorityLifecycle({
      sourceTxHash: SOURCE_TX_HASH,
      getSourceReceipt: async () => ({ logs: ['source'] }),
      deriveDestinationTxHash: () => DESTINATION_TX_HASH,
      getDestinationReceipt: async () => ({ status: 'success' }),
      isDestinationReceiptNotFoundError: () => false,
      isDestinationReceiptSuccessful: (receipt) => receipt.status === 'success',
    });

    expect(inspection.state).toBe('DESTINATION_EXECUTED');
    expect(inspection.destinationTxHash).toBe(DESTINATION_TX_HASH);
  });

  it('treats receipt-not-found as a pending destination', async () => {
    const notFound = new Error('not found');
    const inspection = await inspectPriorityLifecycle({
      sourceTxHash: SOURCE_TX_HASH,
      getSourceReceipt: async () => ({ logs: [] }),
      deriveDestinationTxHash: () => DESTINATION_TX_HASH,
      getDestinationReceipt: async () => {
        throw notFound;
      },
      isDestinationReceiptNotFoundError: (error) => error === notFound,
      isDestinationReceiptSuccessful: () => true,
    });

    expect(inspection.state).toBe('DESTINATION_PENDING');
  });

  it('does not hide unrelated destination receipt errors', async () => {
    const failure = new Error('transport failed');
    await expect(
      inspectPriorityLifecycle({
        sourceTxHash: SOURCE_TX_HASH,
        getSourceReceipt: async () => ({ logs: [] }),
        deriveDestinationTxHash: () => DESTINATION_TX_HASH,
        getDestinationReceipt: async () => {
          throw failure;
        },
        isDestinationReceiptNotFoundError: () => false,
        isDestinationReceiptSuccessful: () => true,
      }),
    ).rejects.toBe(failure);
  });

  it('waits once for each chain and returns the destination receipt', async () => {
    let sourceWaits = 0;
    let destinationWaits = 0;
    const result = await waitForPriorityLifecycle({
      sourceTxHash: SOURCE_TX_HASH,
      target: 'destination',
      waitForSourceReceipt: async () => {
        sourceWaits += 1;
        return { logs: [] };
      },
      deriveDestinationTxHash: () => DESTINATION_TX_HASH,
      waitForDestinationReceipt: async () => {
        destinationWaits += 1;
        return { status: 1 };
      },
      getDestinationReceipt: async () => null,
      isDestinationReceiptSuccessful: (receipt) => receipt.status === 1,
    });

    expect(sourceWaits).toBe(1);
    expect(destinationWaits).toBe(1);
    expect(result.destinationReceipt).toEqual({ status: 1 });
  });

  it('returns the source receipt without deriving a destination for source waits', async () => {
    let derived = false;
    const result = await waitForPriorityLifecycle({
      sourceTxHash: SOURCE_TX_HASH,
      target: 'source',
      waitForSourceReceipt: async () => ({ logs: [] }),
      deriveDestinationTxHash: () => {
        derived = true;
        return DESTINATION_TX_HASH;
      },
      waitForDestinationReceipt: async () => null,
      getDestinationReceipt: async () => null,
      isDestinationReceiptSuccessful: () => true,
    });

    expect(result.sourceReceipt).toEqual({ logs: [] });
    expect(derived).toBe(false);
  });

  it('falls back to a direct receipt read after an empty destination wait', async () => {
    const result = await waitForPriorityLifecycle({
      sourceTxHash: SOURCE_TX_HASH,
      target: 'destination',
      waitForSourceReceipt: async () => ({ logs: [] }),
      deriveDestinationTxHash: () => DESTINATION_TX_HASH,
      waitForDestinationReceipt: async () => null,
      getDestinationReceipt: async () => ({ status: 1 }),
      isDestinationReceiptSuccessful: (receipt) => receipt.status === 1,
    });

    expect(result.destinationReceipt).toEqual({ status: 1 });
  });

  it('rejects missing hashes, missing receipts, and failed destination execution', async () => {
    const base = {
      sourceTxHash: SOURCE_TX_HASH,
      target: 'destination' as const,
      waitForSourceReceipt: async () => ({ logs: [] }),
      deriveDestinationTxHash: () => DESTINATION_TX_HASH as Hex | null,
      waitForDestinationReceipt: async () => ({ status: 1 }) as { status: number } | null,
      getDestinationReceipt: async () => null as { status: number } | null,
      isDestinationReceiptSuccessful: (receipt: { status: number }) => receipt.status === 1,
    };

    await expect(
      waitForPriorityLifecycle({ ...base, deriveDestinationTxHash: () => null }),
    ).rejects.toThrow(/Failed to extract L2 transaction hash/);
    await expect(
      waitForPriorityLifecycle({
        ...base,
        waitForDestinationReceipt: async () => null,
      }),
    ).rejects.toThrow(/was not found/);
    await expect(
      waitForPriorityLifecycle({
        ...base,
        waitForDestinationReceipt: async () => ({ status: 0 }),
      }),
    ).rejects.toThrow(/execution failed/);
  });
});
