/* eslint-disable @typescript-eslint/no-unsafe-argument */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// tests/e2e/deposits.eth.test.ts
import { describe, it, expect, beforeAll } from 'bun:test';
import type { Address, Hex } from '../../../core/types/primitives.ts';
import { ETH_ADDRESS } from '../../../core/constants.ts';
import { createTestClientAndSdk, waitForL1Inclusion, verifyDepositBalances } from './helpers.ts';

const DEPOSIT_WEI = 1_000_000_000_000_000_000n; // 1 ETH

describe('deposits.e2e (ethers): ETH deposit', () => {
  // Shared state for all tests in this suite
  let client: any, sdk: any, me: Address;
  let balancesBefore: { l1: bigint; l2: bigint };
  let depositHandle: any;
  let quoteResult: any;

  // Runs once before all tests in this suite
  beforeAll(async () => {
    ({ client, sdk } = createTestClientAndSdk());
    me = (await client.signer.getAddress()) as Address;
    const [l1, l2] = await Promise.all([client.l1.getBalance(me), client.l2.getBalance(me)]);
    balancesBefore = { l1, l2 };
  });

  it('should get a valid quote for the deposit', async () => {
    quoteResult = await sdk.deposits.quote({
      token: ETH_ADDRESS,
      amount: DEPOSIT_WEI,
      to: me,
    });

    expect(quoteResult.route).toBe('eth-base');
    expect(quoteResult.fees?.total).toBeDefined();
    expect(BigInt(quoteResult.fees.total)).toBeGreaterThan(0n);
    expect(BigInt(quoteResult.l2.gasLimit)).toBeGreaterThanOrEqual(150_000n);
    expect(BigInt(quoteResult.l2.gasLimit)).toBeLessThanOrEqual(500_000n);
  }, 10_000);

  it('should prepare the deposit transaction steps', async () => {
    const plan = await sdk.deposits.prepare({
      token: ETH_ADDRESS,
      amount: DEPOSIT_WEI,
      to: me,
    });
    expect(plan.route).toBe('eth-base');
    expect(plan.steps.length).toBeGreaterThan(0);
  }, 10_000);

  it('should create the deposit and get a handle', async () => {
    depositHandle = await sdk.deposits.create({
      token: ETH_ADDRESS,
      amount: DEPOSIT_WEI,
      to: me,
    });

    expect(depositHandle.kind).toBe('deposit');
    expect(depositHandle.l1TxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  }, 30_000);

  it('should be included on L1 after a short wait', async () => {
    expect(depositHandle).toBeDefined(); // Ensure previous test ran
    const status = await waitForL1Inclusion(sdk, depositHandle);
    expect(['L1_INCLUDED', 'L2_PENDING', 'L2_EXECUTED', 'L2_FAILED']).toContain(status.phase);
  }, 60_000);

  it('should execute successfully on L2', async () => {
    expect(depositHandle).toBeDefined();
    const l2Rcpt = await sdk.deposits.wait(depositHandle, { for: 'l2' });

    expect(l2Rcpt).toBeTruthy();
    expect(l2Rcpt.status).toBe(1);

    const finalStatus = await sdk.deposits.status(depositHandle);
    expect(finalStatus.phase).toBe('L2_EXECUTED');
  }, 90_000);

  it('should reflect correct balance changes on L1 and L2', async () => {
    expect(depositHandle).toBeDefined();
    expect(quoteResult).toBeDefined();

    const l1TxHashes = depositHandle.stepHashes
      ? Object.values(depositHandle.stepHashes)
      : [depositHandle.l1TxHash];

    await verifyDepositBalances(client, me, balancesBefore, DEPOSIT_WEI, l1TxHashes as Hex[]);
  }, 30_000);
});
