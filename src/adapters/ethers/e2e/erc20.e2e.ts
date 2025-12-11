/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
// tests/e2e/deposits-withdrawals.erc20.e2e.ts
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeAll } from 'bun:test';
import type { Address } from '../../../core/types/primitives.ts';
import {
  createTestClientAndSdk,
  makeDeployers,
  deployMintableErc20,
  mintTo,
  erc20BalanceOf,
  waitForL2InclusionWithdraw,
  waitUntilReadyToFinalize,
} from './helpers.ts';
import type { Contract } from 'ethers';

// Adjust to your token decimals
const DECIMALS = 6n;
const UNIT = 10n ** DECIMALS;

// Test amounts
const DEPOSIT_AMOUNT = 1_000_000n * UNIT; // 1,000,000 units
const WITHDRAW_FRACTION = 2n; // withdraw 1/2 of L2 balance

describe('e2e (ethers): ERC-20 deposit L1->L2 and withdraw L2->L1', () => {
  let client: any, sdk: any, me: Address;

  // Token addresses
  let l1TokenAddr: Address;
  let l2TokenAddr: Address;

  // Snapshots
  let l1BalBeforeDeposit: bigint;
  let l2BalBeforeDeposit: bigint;

  // Deposit handle
  let depositHandle: any;

  beforeAll(async () => {
    ({ client, sdk } = createTestClientAndSdk());
    me = (await client.signer.getAddress()) as Address;

    const { deployerL1 } = makeDeployers(client.l1, client.l2);

    // Deploy L1 token and mint
    const tokenL1 = await deployMintableErc20(
      client.l1,
      deployerL1,
      'USD Token',
      'USDT',
      Number(DECIMALS),
    );
    l1TokenAddr = (await tokenL1.getAddress()) as Address;
    const contract = tokenL1.connect(deployerL1);
    await mintTo(contract as Contract, me, DEPOSIT_AMOUNT * 10n);

    // Snapshot pre-deposit balances
    [l1BalBeforeDeposit, l2BalBeforeDeposit] = await Promise.all([
      erc20BalanceOf(client.l1, l1TokenAddr, me),
      // L2 token not deployed yet — treat as 0 until after deposit
      Promise.resolve(0n),
    ]);
  });

  // -------------------
  // Deposit L1 -> L2
  // -------------------

  it('deposits: should quote ERC-20 deposit', async () => {
    const quote = await sdk.deposits.quote({
      token: l1TokenAddr,
      amount: DEPOSIT_AMOUNT,
      to: me,
    });
    expect(quote.route).toBeDefined();
    expect(quote.fees?.total).toBeDefined();
    expect(BigInt(quote.fees.total)).toBeGreaterThan(0n);
  }, 20_000);

  it('deposits: should prepare steps (includes approve + bridge)', async () => {
    const plan = await sdk.deposits.prepare({
      token: l1TokenAddr,
      amount: DEPOSIT_AMOUNT,
      to: me,
    });

    expect(plan.steps.length).toBeGreaterThan(0);

    const hasApprove = plan.steps.some(
      (s: any) =>
        s.kind?.toString().startsWith('approve') ||
        (typeof s.tx?.data === 'string' && s.tx.data.startsWith('0x095ea7b3')), // approve(address,uint256)
    );
    expect(hasApprove).toBeTrue();
  }, 20_000);

  it('deposits: should create and include on L1 then execute on L2', async () => {
    depositHandle = await sdk.deposits.create({
      token: l1TokenAddr,
      amount: DEPOSIT_AMOUNT,
      to: me,
    });

    expect(depositHandle.kind).toBe('deposit');
    expect(depositHandle.l1TxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    // Wait L1 inclusion
    const l1Rcpt = await sdk.deposits.wait(depositHandle, { for: 'l1' });
    expect(l1Rcpt?.status).toBe(1);

    // Wait L2 execution
    const l2Rcpt = await sdk.deposits.wait(depositHandle, { for: 'l2' });
    expect(l2Rcpt?.status).toBe(1);

    const status = await sdk.deposits.status(depositHandle);
    expect(status.phase).toBe('L2_EXECUTED');
  }, 180_000);

  it('deposits: should reflect L2 token credit (resolve L2 token and check deltas)', async () => {
    const resolved = await sdk.helpers.l2TokenAddress(l1TokenAddr);
    expect(resolved).toMatch(/^0x[0-9a-fA-F]{40}$/);
    l2TokenAddr = resolved as Address;

    const [l1After, l2After] = await Promise.all([
      erc20BalanceOf(client.l1, l1TokenAddr, me),
      erc20BalanceOf(client.l2, l2TokenAddr, me),
    ]);

    // L1 decreased by at least deposit amount
    expect(l1BalBeforeDeposit - l1After >= DEPOSIT_AMOUNT).toBeTrue();

    // L2 increased by at least deposit amount
    const l2Delta = l2After - l2BalBeforeDeposit;
    expect(l2Delta >= DEPOSIT_AMOUNT).toBeTrue();
  }, 30_000);

  // -------------------
  // Withdraw L2 -> L1
  // -------------------

  it('withdrawals: should quote + prepare ERC-20 withdrawal', async () => {
    // Determine a safe withdrawal amount based on current L2 balance
    const l2Now = await erc20BalanceOf(client.l2, l2TokenAddr, me);
    expect(l2Now > 0n).toBeTrue();

    const withdrawAmount = l2Now / WITHDRAW_FRACTION || l2Now;

    const quote = await sdk.withdrawals.quote({
      token: l2TokenAddr,
      amount: withdrawAmount,
      to: me,
    });
    expect(quote.route).toBeDefined();

    const plan = await sdk.withdrawals.prepare({
      token: l2TokenAddr,
      amount: withdrawAmount,
      to: me,
    });

    expect(plan.steps.length).toBeGreaterThan(0);

    // Expect an L2 approve step
    const hasApprove = plan.steps.some(
      (s: any) =>
        s.kind?.toString().startsWith('approve') ||
        (typeof s.tx?.data === 'string' && s.tx.data.startsWith('0x095ea7b3')),
    );
    expect(hasApprove).toBeTrue();

    // Expect the L2 asset router withdraw step
    const hasWithdraw = plan.steps.some((s: any) =>
      String(s.key).includes('l2-asset-router:withdraw'),
    );
    expect(hasWithdraw).toBeTrue();
  }, 25_000);

  it('withdrawals: should create withdrawal, include on L2, become ready and finalize on L1, then reflect balances', async () => {
    const l2Before = await erc20BalanceOf(client.l2, l2TokenAddr, me);
    const l1Before = await erc20BalanceOf(client.l1, l1TokenAddr, me);
    const withdrawAmount = l2Before / WITHDRAW_FRACTION || l2Before;

    const handle = await sdk.withdrawals.create({
      token: l2TokenAddr,
      amount: withdrawAmount,
      to: me,
    });

    // Wait L2 inclusion (status != L2_PENDING/UNKNOWN)
    const s = await waitForL2InclusionWithdraw(sdk, handle, 120_000);
    expect(['PENDING', 'READY_TO_FINALIZE', 'FINALIZED']).toContain(s.phase);

    const l2Rcpt = await sdk.withdrawals.wait(handle, { for: 'l2' });
    expect(l2Rcpt?.status).toBe(1);

    // Wait until ready-to-finalize
    const ready = await waitUntilReadyToFinalize(sdk, handle, 300_000, 4000);
    expect(['READY_TO_FINALIZE', 'FINALIZED']).toContain(ready.phase);

    // Finalize
    const { l2TxHash } = await sdk.withdrawals.status(handle);
    const { status: afterFinalize } = await sdk.withdrawals.finalize(l2TxHash);
    expect(['FINALIZED', 'READY_TO_FINALIZE']).toContain(afterFinalize.phase);

    await sdk.withdrawals.wait(handle, { for: 'finalized' });

    // --- Balance assertions
    const [l2After, l1After] = await Promise.all([
      erc20BalanceOf(client.l2, l2TokenAddr, me),
      erc20BalanceOf(client.l1, l1TokenAddr, me),
    ]);

    // L2 burned at least the withdrawal amount (plus fees are paid in ETH, not token)
    const l2Delta = l2Before - l2After;
    expect(l2Delta >= withdrawAmount).toBeTrue();

    // L1 credited by at least the withdrawal amount (finalize gas is in ETH)
    const l1Delta = l1After - l1Before;
    expect(l1Delta >= withdrawAmount).toBeTrue();
  }, 480_000);
});
