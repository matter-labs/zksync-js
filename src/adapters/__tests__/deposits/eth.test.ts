import { describe, it, expect } from 'bun:test';

import { routeEthDirect as routeEthers } from '../../ethers/resources/deposits/routes/eth.ts';
import { routeEthDirect as routeViem } from '../../viem/resources/deposits/routes/eth.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  makeDepositContext,
  setBridgehubBaseCost,
  describeForAdapters,
} from '../adapter-harness.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';
import { parseDirectBridgeTx } from '../decode-helpers.ts';

type AdapterKind = 'ethers' | 'viem';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

describeForAdapters('adapters/deposits/routeEthDirect', (kind, factory) => {
  it('computes mintValue, encodes direct call, and produces a single plan step', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 1_234n;
    const baseCost = 2_000n;
    setBridgehubBaseCost(harness, ctx, baseCost);

    if (harness.kind === 'ethers') {
      harness.setEstimateGas(200_000n);
    }

    const res = await ROUTES[kind].build({ amount } as any, ctx as any);
    expect(res.approvals.length).toBe(0);
    expect(res.steps.length).toBe(1);

    const expectedMint = baseCost + ctx.operatorTip + amount;
    expect(res.quoteExtras.baseCost).toBe(baseCost);
    expect(res.quoteExtras.mintValue).toBe(expectedMint);

    const step = res.steps[0];
    expect(step.key).toBe('bridgehub:direct');
    expect(step.kind).toBe('bridgehub:direct');

    const info = parseDirectBridgeTx(kind, step.tx);
    expect(info.to).toBe(ADAPTER_TEST_ADDRESSES.bridgehub.toLowerCase());
    expect(info.from).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());
    expect(info.value).toBe(expectedMint);
    expect(info.mintValue).toBe(expectedMint);
    expect(info.l2Contract).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());
    expect(info.l2Value).toBe(amount);
    expect(info.l2GasLimit).toBe(ctx.l2GasLimit);
    expect(info.refundRecipient).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());

    if (kind === 'ethers') {
      expect(info.gasLimit).toBe((200_000n * 120n) / 100n);
    }
  });

  it('uses payload.to as the target L2 contract when provided', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 5_000n;
    const baseCost = 1_000n;
    const target = '0x2222222222222222222222222222222222222222';
    setBridgehubBaseCost(harness, ctx, baseCost);

    if (harness.kind === 'ethers') {
      harness.setEstimateGas(120_000n);
    }

    const res = await ROUTES[kind].build({ amount, to: target } as any, ctx as any);
    const info = parseDirectBridgeTx(kind, res.steps[0].tx);

    expect(info.l2Contract).toBe(target.toLowerCase());
    expect(info.l2Value).toBe(amount);
    const expectedMint = baseCost + ctx.operatorTip + amount;
    expect(res.quoteExtras.mintValue).toBe(expectedMint);
  });

  if (kind === 'ethers') {
    it('ignores estimateGas failures and emits a tx without gasLimit', async () => {
      const harness = factory();
      const ctx = makeDepositContext(harness);
      const amount = 777n;
      const baseCost = 999n;
      setBridgehubBaseCost(harness, ctx, baseCost);
      harness.setEstimateGas(new Error('boom'));

      const res = await ROUTES.ethers.build({ amount } as any, ctx as any);
      const info = parseDirectBridgeTx('ethers', res.steps[0].tx);
      expect(info.gasLimit).toBeUndefined();
    });
  }

  it('wraps base cost call failures as ZKsyncError', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 1_000n;

    let caught: unknown;
    try {
      await ROUTES[kind].build({ amount } as any, ctx as any);
    } catch (err) {
      caught = err;
    }
    expect(isZKsyncError(caught)).toBe(true);
    expect(String(caught)).toMatch(/Could not fetch L2 base cost from Bridgehub/);
  });
});
