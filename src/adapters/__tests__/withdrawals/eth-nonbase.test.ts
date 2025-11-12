import { describe, it, expect } from 'bun:test';

import { routeEthNonBase as routeEthers } from '../../ethers/resources/withdrawals/routes/eth-nonbase.ts';
import { routeEthNonBase as routeViem } from '../../viem/resources/withdrawals/routes/eth-nonbase.ts';
import { makeWithdrawalContext, describeForAdapters } from '../adapter-harness.ts';
import { IBaseTokenABI } from '../../../core/internal/abi-registry.ts';
import { L2_BASE_TOKEN_ADDRESS } from '../../../core/constants.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';
import { decodeBaseTokenWithdraw } from '../decode-helpers.ts';

type AdapterKind = 'ethers' | 'viem';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

describeForAdapters('adapters/withdrawals/routeEthNonBase', (kind, factory) => {
  it('builds a withdraw step targeting the base token system with gas helpers', async () => {
    const harness = factory();
    const ctx = makeWithdrawalContext(harness, { baseIsEth: false });
    const amount = 4_200n;
    const to = '0x9999999999999999999999999999999999999999';

    if (kind === 'ethers') {
      harness.setL2EstimateGas(180_000n);
    } else {
      harness.setSimulateResponse(
        {
          request: {
            address: L2_BASE_TOKEN_ADDRESS,
            abi: IBaseTokenABI,
            functionName: 'withdraw',
            args: [to],
            value: amount,
            account: (ctx.client as any).account,
          },
        },
        'l2',
      );
    }

    const res = await ROUTES[kind].build(
      { token: L2_BASE_TOKEN_ADDRESS, amount, to } as any,
      ctx as any,
    );
    expect(res.approvals.length).toBe(0);
    expect(res.steps.length).toBe(1);

    const step = res.steps[0];
    expect(step.key).toBe('l2-base-token:withdraw');
    expect(step.kind).toBe('l2-base-token:withdraw');

    if (kind === 'ethers') {
      const tx = step.tx as any;
      expect((tx.to as string).toLowerCase()).toBe(L2_BASE_TOKEN_ADDRESS.toLowerCase());
      expect(BigInt(tx.value ?? 0n)).toBe(amount);
      expect(decodeBaseTokenWithdraw(tx.data)).toBe(to.toLowerCase());
      expect(tx.gasLimit).toBe((180_000n * 115n) / 100n);
    } else {
      const tx = step.tx as any;
      expect((tx.address as string).toLowerCase()).toBe(L2_BASE_TOKEN_ADDRESS.toLowerCase());
      expect(BigInt(tx.value ?? 0n)).toBe(amount);
      const args = tx.args as unknown[];
      expect(((args?.[0] as string) ?? '').toLowerCase()).toBe(to.toLowerCase());
    }
  });

  it('preflight rejects when token mismatch or baseIsEth true', async () => {
    const harness = factory();
    const ctxMismatch = makeWithdrawalContext(harness, { baseIsEth: false });

    const preflight = ROUTES[kind].preflight!;
    await expect(preflight({ token: '0xdeadbeef' } as any, ctxMismatch as any)).rejects.toThrow(
      /requires the L2 base-token alias/i,
    );

    const ctxEth = makeWithdrawalContext(harness, { baseIsEth: true });
    await expect(preflight({ token: L2_BASE_TOKEN_ADDRESS } as any, ctxEth as any)).rejects.toThrow(
      /requires chain base ≠ ETH/i,
    );
  });

  if (kind === 'ethers') {
    it('handles estimateGas failures by omitting gasLimit', async () => {
      const harness = factory();
      const ctx = makeWithdrawalContext(harness, { baseIsEth: false });
      harness.setL2EstimateGas(new Error('boom'));

      const res = await ROUTES.ethers.build(
        { token: L2_BASE_TOKEN_ADDRESS, amount: 10n } as any,
        ctx as any,
      );
      expect((res.steps[0].tx as any).gasLimit).toBeUndefined();
    });
  } else {
    it('wraps simulation failures as ZKsyncError', async () => {
      const harness = factory();
      const ctx = makeWithdrawalContext(harness, { baseIsEth: false });
      harness.setSimulateError(new Error('fail'), 'l2');

      let caught: unknown;
      try {
        await ROUTES.viem.build({ token: L2_BASE_TOKEN_ADDRESS, amount: 1n } as any, ctx as any);
      } catch (err) {
        caught = err;
      }
      expect(isZKsyncError(caught)).toBe(true);
      expect(String(caught)).toMatch(/Failed to simulate L2 base-token withdraw/);
    });
  }
});
