import { describe, expect, it } from 'bun:test';

import { createWithdrawalsResource as createEthersWithdrawals } from '../../ethers/resources/withdrawals/index.ts';
import { createWithdrawalsResource as createViemWithdrawals } from '../../viem/resources/withdrawals/index.ts';
import { createAdapterHarness, type AdapterHarness } from '../adapter-harness.ts';
import type { Hex } from '../../../core/types/primitives.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';

const L2_TX_HASH = `0x${'ab'.repeat(32)}` as Hex;

function withdrawalsFor(harness: AdapterHarness) {
  return harness.kind === 'ethers'
    ? createEthersWithdrawals(harness.client)
    : createViemWithdrawals(harness.client);
}

function stubL2Receipt(harness: AdapterHarness, status: number | 'success' | 'reverted') {
  (
    harness.l2 as { getTransactionReceipt: (arg?: unknown) => Promise<unknown> }
  ).getTransactionReceipt = async () => ({ status, logs: [] });
}

describe('adapters/withdrawals/status reverted L2 receipt', () => {
  for (const kind of ['ethers', 'viem'] as const) {
    const reverted = kind === 'ethers' ? 0 : 'reverted';
    const succeeded = kind === 'ethers' ? 1 : 'success';

    it(`${kind} reports a reverted L2 withdrawal as UNFINALIZABLE`, async () => {
      const harness = createAdapterHarness(kind);
      stubL2Receipt(harness, reverted);

      const status = await withdrawalsFor(harness).status(L2_TX_HASH);

      expect(status.phase).toBe('UNFINALIZABLE');
      expect(status.reason).toBe('l2-reverted');
      expect(status.l2TxHash).toBe(L2_TX_HASH);
    });

    it(`${kind} keeps a successful receipt with no proof yet as PENDING`, async () => {
      const harness = createAdapterHarness(kind);
      stubL2Receipt(harness, succeeded);

      const status = await withdrawalsFor(harness).status(L2_TX_HASH);

      expect(status.phase).toBe('PENDING');
    });

    it(`${kind} wait for ready throws when the L2 withdrawal reverted`, async () => {
      const harness = createAdapterHarness(kind);
      stubL2Receipt(harness, reverted);

      const caught = await withdrawalsFor(harness)
        .wait(L2_TX_HASH, { for: 'ready', pollMs: 1000, timeoutMs: 50 })
        .then(
          () => undefined,
          (err: unknown) => err,
        );

      expect(isZKsyncError(caught)).toBe(true);
      expect(String(caught)).toMatch(/never be finalized/);
    });
  }
});
