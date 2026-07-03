/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { beforeAll, describe, expect, it } from 'bun:test';
import type { Address } from 'viem';
import { ETH_ADDRESS } from '../../../../core/constants.ts';
import {
  createPrividiumClientAndSdk,
  fetchPrividiumProfile,
  loginPrividiumUser,
  PRIVIDIUM_BRIDGE_ROLE,
  waitForL1Inclusion,
  waitForL2InclusionWithdraw,
} from './helpers.ts';

const DEPOSIT_WEI = 1_000_000_000_000_000_000n; // 1 ETH
const WITHDRAW_WEI = 1_000_000_000_000_000n; // 0.001 ETH

describe('prividium.e2e (viem): ETH bridge over authenticated RPC', () => {
  let token: string;
  let client: any;
  let sdk: any;
  let me: Address;
  let profileRoles: string[];
  let depositHandle: any;
  let withdrawalHandle: any;
  let l2BalanceBeforeDeposit: bigint;
  let l2BalanceAfterDeposit: bigint;

  beforeAll(async () => {
    const login = await loginPrividiumUser();
    token = login.token;
    me = login.address;
    ({ client, sdk } = createPrividiumClientAndSdk(token));

    const profile = await fetchPrividiumProfile(token);
    profileRoles = profile.roles.map((role) => role.roleName);
    l2BalanceBeforeDeposit = await client.l2.getBalance({ address: me });
  }, 20_000);

  it('logs in as the non-admin bridge user', () => {
    expect(profileRoles).toContain(PRIVIDIUM_BRIDGE_ROLE);
    expect(profileRoles).not.toContain('admin');
  });

  it('quotes and prepares an ETH deposit through Prividium RPC', async () => {
    const quote = await sdk.deposits.quote({
      token: ETH_ADDRESS,
      amount: DEPOSIT_WEI,
      to: me,
    });
    expect(quote.route).toBe('eth-base');
    expect(BigInt(quote.mintValue)).toBeGreaterThanOrEqual(DEPOSIT_WEI);

    const plan = await sdk.deposits.prepare({
      token: ETH_ADDRESS,
      amount: DEPOSIT_WEI,
      to: me,
    });
    expect(plan.route).toBe('eth-base');
    expect(plan.steps.length).toBeGreaterThan(0);
  }, 20_000);

  it('creates an ETH deposit and observes L2 execution through Prividium RPC', async () => {
    depositHandle = await sdk.deposits.create({
      token: ETH_ADDRESS,
      amount: DEPOSIT_WEI,
      to: me,
    });
    expect(depositHandle.kind).toBe('deposit');
    expect(depositHandle.l1TxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const status = await waitForL1Inclusion(sdk, depositHandle, 90_000);
    expect(['L1_INCLUDED', 'L2_PENDING', 'L2_EXECUTED', 'L2_FAILED']).toContain(status.phase);

    const l2Receipt = await sdk.deposits.wait(depositHandle, { for: 'l2' });
    expect(l2Receipt).toBeTruthy();
    expect(l2Receipt.status).toBe('success');

    const finalStatus = await sdk.deposits.status(depositHandle);
    expect(finalStatus.phase).toBe('L2_EXECUTED');

    l2BalanceAfterDeposit = await client.l2.getBalance({ address: me });
    expect(l2BalanceAfterDeposit - l2BalanceBeforeDeposit).toBeGreaterThanOrEqual(DEPOSIT_WEI);
  }, 150_000);

  it('quotes and prepares an ETH withdrawal through Prividium RPC', async () => {
    expect(l2BalanceAfterDeposit).toBeGreaterThanOrEqual(WITHDRAW_WEI);

    const quote = await sdk.withdrawals.quote({
      token: ETH_ADDRESS,
      amount: WITHDRAW_WEI,
      to: me,
    });
    expect(quote.route).toBe('base');
    expect(quote.fees.l2.gasLimit).toBeDefined();

    const plan = await sdk.withdrawals.prepare({
      token: ETH_ADDRESS,
      amount: WITHDRAW_WEI,
      to: me,
    });
    expect(plan.route).toBe('base');
    expect(plan.steps.length).toBeGreaterThan(0);
  }, 20_000);

  it('creates an ETH withdrawal and observes the L2 receipt through Prividium RPC', async () => {
    withdrawalHandle = await sdk.withdrawals.create({
      token: ETH_ADDRESS,
      amount: WITHDRAW_WEI,
      to: me,
    });
    expect(withdrawalHandle.kind).toBe('withdrawal');
    expect(withdrawalHandle.l2TxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const l2Receipt = await sdk.withdrawals.wait(withdrawalHandle, { for: 'l2' });
    expect(l2Receipt).toBeTruthy();
    expect(l2Receipt.status).toBe('success');

    const status = await waitForL2InclusionWithdraw(sdk, withdrawalHandle, 90_000);
    expect(['PENDING', 'READY_TO_FINALIZE', 'FINALIZED']).toContain(status.phase);
  }, 120_000);
});
