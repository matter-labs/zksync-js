/* eslint-disable @typescript-eslint/no-unsafe-argument */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

// tests/e2e/viem/deposits.eth.test.ts
import { describe, it, expect, beforeAll } from 'bun:test';
import type { Address } from '../../../core/types/primitives.ts';
import { ETH_ADDRESS } from '../../../core/constants.ts';
import { createTestClientAndSdk, waitForL1Inclusion, verifyDepositBalances } from './helpers.ts';
import { sleep } from 'bun';

const DEPOSIT_WEI = 1_000_000_000_000_000_000n; // 1 ETH

describe('deposits.e2e (viem): ETH deposit', () => {
  let client: any, sdk: any, me: Address;
  let balancesBefore: { l1: bigint; l2: bigint };
  let handle: any;
  let quoteResult: any;

  beforeAll(async () => {
    ({ client, sdk } = createTestClientAndSdk());
    me = client.account.address as Address;

    const [l1, l2] = await Promise.all([
      client.l1.getBalance({ address: me }),
      client.l2.getBalance({ address: me }),
    ]);
    balancesBefore = { l1, l2 };
  });

  it('should get a valid quote for the deposit', async () => {
    quoteResult = await sdk.deposits.quote({
      token: ETH_ADDRESS,
      amount: DEPOSIT_WEI,
      to: me,
    });

    expect(quoteResult.route).toBe('eth-base');
    expect(quoteResult.mintValue).toBeDefined();
    expect(BigInt(quoteResult.mintValue)).toBeGreaterThanOrEqual(DEPOSIT_WEI);
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
    handle = await sdk.deposits.create({
      token: ETH_ADDRESS,
      amount: DEPOSIT_WEI,
      to: me,
    });

    expect(handle.kind).toBe('deposit');
    expect(handle.l1TxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  }, 30_000);

  it('should be included on L1 after a short wait', async () => {
    await sleep(1500);
    const status = await waitForL1Inclusion(sdk, handle);
    expect(['L1_INCLUDED', 'L2_PENDING', 'L2_EXECUTED', 'L2_FAILED']).toContain(status.phase);
  }, 60_000);

  it('should execute successfully on L2', async () => {
    const l2Rcpt = await sdk.deposits.wait(handle, { for: 'l2' });
    expect(l2Rcpt).toBeTruthy();
    expect(l2Rcpt.status).toBe('success');

    const final = await sdk.deposits.status(handle);
    expect(final.phase).toBe('L2_EXECUTED');
  }, 90_000);

  it('should reflect correct balance changes on L1 and L2', async () => {
    const l1TxHashes = handle.stepHashes ? Object.values(handle.stepHashes) : [handle.l1TxHash];

    await verifyDepositBalances({
      client,
      me,
      balancesBefore,
      mintValue: BigInt(quoteResult.mintValue),
      amount: DEPOSIT_WEI,
      l1TxHashes,
    });
  }, 30_000);
});
