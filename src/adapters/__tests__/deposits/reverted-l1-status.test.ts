import { describe, expect, it } from 'bun:test';

import { createDepositsResource as createEthersDeposits } from '../../ethers/resources/deposits/index.ts';
import { createDepositsResource as createViemDeposits } from '../../viem/resources/deposits/index.ts';
import { createAdapterHarness, type AdapterHarness } from '../adapter-harness.ts';
import type { Hex } from '../../../core/types/primitives.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';

const L1_TX_HASH = `0x${'cd'.repeat(32)}` as Hex;

function depositsFor(harness: AdapterHarness) {
  return harness.kind === 'ethers'
    ? createEthersDeposits(harness.client)
    : createViemDeposits(harness.client);
}

function stubL1Receipt(harness: AdapterHarness, status: number | 'success' | 'reverted') {
  const receipt = { status, logs: [] as unknown[] };
  const l1 = harness.l1 as {
    getTransactionReceipt: (arg?: unknown) => Promise<unknown>;
    waitForTransaction?: (hash?: string) => Promise<unknown>;
    waitForTransactionReceipt?: (arg?: unknown) => Promise<unknown>;
  };
  l1.getTransactionReceipt = async () => receipt;
  l1.waitForTransaction = async () => receipt;
  l1.waitForTransactionReceipt = async () => receipt;
}

describe('adapters/deposits/status reverted L1 receipt', () => {
  for (const kind of ['ethers', 'viem'] as const) {
    const reverted = kind === 'ethers' ? 0 : 'reverted';
    const succeeded = kind === 'ethers' ? 1 : 'success';

    it(`${kind} reports a reverted L1 deposit as L1_FAILED`, async () => {
      const harness = createAdapterHarness(kind);
      stubL1Receipt(harness, reverted);

      const status = await depositsFor(harness).status(L1_TX_HASH);

      expect(status.phase).toBe('L1_FAILED');
      expect(status.l1TxHash).toBe(L1_TX_HASH);
      expect(status.l2TxHash).toBeUndefined();
    });

    it(`${kind} keeps a successful L1 receipt with no L2 hash as L1_INCLUDED`, async () => {
      const harness = createAdapterHarness(kind);
      stubL1Receipt(harness, succeeded);

      const status = await depositsFor(harness).status(L1_TX_HASH);

      expect(status.phase).toBe('L1_INCLUDED');
    });

    it(`${kind} wait for l2 throws when the L1 deposit reverted`, async () => {
      const harness = createAdapterHarness(kind);
      stubL1Receipt(harness, reverted);

      const caught = await depositsFor(harness)
        .wait(L1_TX_HASH, { for: 'l2' })
        .then(
          () => undefined,
          (err: unknown) => err,
        );

      expect(isZKsyncError(caught)).toBe(true);
      expect(String(caught)).toMatch(/L1 deposit transaction reverted/);
    });
  }
});
