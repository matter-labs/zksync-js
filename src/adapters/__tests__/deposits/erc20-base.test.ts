import { describe, it, expect } from 'bun:test';

import { routeErc20Base as routeEthers } from '../../ethers/resources/deposits/routes/erc20-base.ts';
import { routeErc20Base as routeViem } from '../../viem/resources/deposits/routes/erc20-base.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  makeDepositContext,
  setBridgehubBaseCost,
  setErc20Allowance,
  describeForAdapters,
} from '../adapter-harness.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';
import { parseDirectBridgeTx, parseApproveTx } from '../decode-helpers.ts';
import { SAFE_L1_BRIDGE_GAS } from '../../../core/constants.ts';

type AdapterKind = 'ethers' | 'viem';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

describeForAdapters('adapters/deposits/routeErc20Base', (kind, factory) => {
  it('skips approval when allowance covers mintValue and builds a zero-value bridge tx', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 1_000n;
    const baseCost = 2_000n;
    const expectedMint = baseCost + ctx.operatorTip + amount;

    setBridgehubBaseCost(harness, ctx, baseCost);
    setErc20Allowance(
      harness,
      ADAPTER_TEST_ADDRESSES.baseTokenFor324,
      ctx.sender,
      ctx.l1AssetRouter,
      expectedMint,
    );

    const payload = { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any;
    const res = await ROUTES[kind].build(payload, ctx as any);

    expect(res.approvals.length).toBe(0);
    expect(res.steps.length).toBe(1);
    expect(res.fees?.l2.baseCost).toBe(baseCost);
    expect(res.fees?.mintValue).toBe(expectedMint);

    const bridge = res.steps[0];
    expect(bridge.key).toBe('bridgehub:direct:erc20-base');
    const info = parseDirectBridgeTx(kind, bridge.tx);
    expect(info.to).toBe(ADAPTER_TEST_ADDRESSES.bridgehub.toLowerCase());
    expect(info.from).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());
    expect(info.value).toBe(0n);
    expect(info.mintValue).toBe(expectedMint);
    expect(info.l2Value).toBe(amount);
    expect(info.l2Contract).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());

    if (kind === 'ethers') {
      expect(info.gasLimit).toBe((100_000n * 120n) / 100n);
    }
  });

  it('adds approval when allowance is insufficient and encodes approve step correctly', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 5_000n;
    const baseCost = 4_000n;
    const expectedMint = baseCost + ctx.operatorTip + amount;

    setBridgehubBaseCost(harness, ctx, baseCost);
    setErc20Allowance(
      harness,
      ADAPTER_TEST_ADDRESSES.baseTokenFor324,
      ctx.sender,
      ctx.l1AssetRouter,
      expectedMint - 1n,
    );

    const payload = { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any;
    const res = await ROUTES[kind].build(payload, ctx as any);

    expect(res.approvals.length).toBe(1);
    const [approval] = res.approvals;
    expect(approval.token.toLowerCase()).toBe(ADAPTER_TEST_ADDRESSES.baseTokenFor324.toLowerCase());
    expect(approval.spender.toLowerCase()).toBe(ctx.l1AssetRouter.toLowerCase());
    expect(approval.amount).toBe(expectedMint);
    expect(res.fees?.mintValue).toBe(expectedMint);
    expect(res.steps.length).toBe(2);

    const approve = res.steps[0];
    expect(approve.kind).toBe('approve');
    const approveInfo = parseApproveTx(kind, approve.tx);
    expect(approveInfo.to).toBe(ADAPTER_TEST_ADDRESSES.baseTokenFor324.toLowerCase());
    expect(approveInfo.spender).toBe(ctx.l1AssetRouter.toLowerCase());
    expect(approveInfo.amount).toBe(expectedMint);

    const bridge = res.steps[1];
    expect(bridge.key).toBe('bridgehub:direct:erc20-base');
    const info = parseDirectBridgeTx(kind, bridge.tx);
    expect(info.value).toBe(0n);
    expect(info.mintValue).toBe(expectedMint);
    expect(info.l2Value).toBe(amount);
  });

  if (kind === 'ethers') {
    it('ignores estimateGas failures and falls back to the safe gas limit', async () => {
      const harness = factory();
      const ctx = makeDepositContext(harness);
      const amount = 2_000n;
      const baseCost = 3_000n;
      const expectedMint = baseCost + ctx.operatorTip + amount;

      setBridgehubBaseCost(harness, ctx, baseCost);
      setErc20Allowance(
        harness,
        ADAPTER_TEST_ADDRESSES.baseTokenFor324,
        ctx.sender,
        ctx.l1AssetRouter,
        expectedMint,
      );
      harness.setEstimateGas(new Error('no gas'));

      const res = await ROUTES.ethers.build(
        { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any,
        ctx as any,
      );
      const info = parseDirectBridgeTx('ethers', res.steps[0].tx);
      expect(info.gasLimit).toBe(SAFE_L1_BRIDGE_GAS);
    });
  }

  it('wraps allowance failures as ZKsyncError', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 1_000n;
    const baseCost = 2_500n;

    setBridgehubBaseCost(harness, ctx, baseCost);

    let caught: unknown;
    try {
      await ROUTES[kind].build(
        { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any,
        ctx as any,
      );
    } catch (err) {
      caught = err;
    }
    expect(isZKsyncError(caught)).toBe(true);
    expect(String(caught)).toMatch(/Failed to read base-token allowance/);
  });
});
