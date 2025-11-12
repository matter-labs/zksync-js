/* eslint-disable @typescript-eslint/no-unsafe-argument */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// tests/e2e/withdrawals.eth.test.ts
import { describe, it, expect, beforeAll } from 'bun:test';
import type { Address, Hex } from '../../../core/types/primitives.ts';
import { ETH_ADDRESS } from '../../../core/constants.ts';
import {
  createTestClientAndSdk,
  waitUntilReadyToFinalize,
  verifyWithdrawalBalancesAfterFinalize,
  waitForL2InclusionWithdraw,
} from './helpers.ts';

const WITHDRAW_WEI = 1_000_000_000_000_000n; // 0.001 ETH

//TODO: Refactor to share setup with deposits
describe('withdrawals.e2e (ethers): ETH withdrawal', () => {
  // Shared state
  let client: any, sdk: any, me: Address;
  let balancesBefore: { l1: bigint; l2: bigint };
  let handle: any;
  let l2Rcpt: any;
  let finalizeRcpt: any;

  beforeAll(async () => {
    ({ client, sdk } = createTestClientAndSdk());
    me = (await client.signer.getAddress()) as Address;

    // Ensure L2 has funds to withdraw
    const l2Bal = await client.l2.getBalance(me);
    if (l2Bal < WITHDRAW_WEI) {
      throw new Error(
        `Insufficient L2 balance for withdrawal test. Have=${l2Bal} need=${WITHDRAW_WEI}`,
      );
    }

    const [l1, l2] = await Promise.all([client.l1.getBalance(me), l2Bal]);
    balancesBefore = { l1, l2 };
  });

  it('should quote a withdrawal', async () => {
    const q = await sdk.withdrawals.quote({
      token: ETH_ADDRESS,
      amount: WITHDRAW_WEI,
      to: me,
    });
    expect(q.route).toBe('eth-base');
    expect(q.suggestedL2GasLimit).toBeDefined();
  }, 10_000);

  it('should prepare the withdrawal plan', async () => {
    const plan = await sdk.withdrawals.prepare({
      token: ETH_ADDRESS,
      amount: WITHDRAW_WEI,
      to: me,
    });
    expect(plan.route).toBe('eth-base');
    expect(plan.steps.length).toBeGreaterThan(0);
  }, 10_000);

  it('should create the withdrawal and return a handle', async () => {
    handle = await sdk.withdrawals.create({
      token: ETH_ADDRESS,
      amount: WITHDRAW_WEI,
      to: me,
    });
    expect(handle.kind).toBe('withdrawal');
    expect(handle.l2TxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  }, 30_000);

  it('should be included on L2 and return an L2 receipt', async () => {
    // wait({ for: 'l2' }) blocks until L2 receipt is available
    l2Rcpt = await sdk.withdrawals.wait(handle, { for: 'l2' });
    expect(l2Rcpt).toBeTruthy();
    expect(l2Rcpt.status).toBe(1);

    // Status should be at least PENDING (not finalizable yet) or further
    const s = await waitForL2InclusionWithdraw(sdk, handle);
    expect(['PENDING', 'READY_TO_FINALIZE', 'FINALIZED']).toContain(s.phase);
  }, 90_000);

  it('should reach READY_TO_FINALIZE eventually (no side-effects)', async () => {
    const ready = await waitUntilReadyToFinalize(sdk, handle, 180_000, 3000);
    expect(['READY_TO_FINALIZE', 'FINALIZED']).toContain(ready.phase);
  }, 180_000);

  it('should finalize on L1 and reflect correct balance changes', async () => {
    // finalize() sends the L1 finalize tx if needed and returns status + L1 receipt
    const res = await sdk.withdrawals.finalize(handle.l2TxHash as Hex);
    expect(['FINALIZED']).toContain(res.status.phase);

    // receipt may be present; if not, try wait({ for: 'finalized' }) to fetch the L1 rcpt
    finalizeRcpt =
      res.receipt ??
      (await sdk.withdrawals.wait(handle, { for: 'finalized', pollMs: 2500, timeoutMs: 60_000 }));

    // If still no receipt, we still accept FINALIZED
    await verifyWithdrawalBalancesAfterFinalize({
      client,
      me,
      balancesBefore,
      amount: WITHDRAW_WEI,
      l2Rcpt,
      l1FinalizeRcpt: finalizeRcpt ?? null,
    });
  }, 120_000);
});
