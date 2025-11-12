import { describe, it, expect } from 'bun:test';

import { routeEthBase as routeEthers } from '../../ethers/resources/withdrawals/routes/eth.ts';
import { routeEthBase as routeViem } from '../../viem/resources/withdrawals/routes/eth.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  makeWithdrawalContext,
  describeForAdapters,
} from '../adapter-harness.ts';
import { IBaseTokenABI } from '../../../core/internal/abi-registry.ts';
import { L2_BASE_TOKEN_ADDRESS } from '../../../core/constants.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';
import { decodeBaseTokenWithdraw } from '../decode-helpers.ts';

type AdapterKind = 'ethers' | 'viem';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

describeForAdapters('adapters/withdrawals/routeEthBase', (kind, factory) => {
  it('encodes withdraw call with correct defaults and applies gas multiplier', async () => {
    const harness = factory();
    const ctx = makeWithdrawalContext(harness);
    const amount = 1_500n;

    if (kind === 'ethers') {
      harness.setL2EstimateGas(200_000n);
    } else {
      harness.setSimulateResponse(
        {
          request: {
            address: L2_BASE_TOKEN_ADDRESS,
            abi: IBaseTokenABI,
            functionName: 'withdraw',
            args: [ctx.sender as string],
            value: amount,
            account: (ctx.client as any).account,
          },
        },
        'l2',
      );
    }

    const res = await ROUTES[kind].build({ amount } as any, ctx as any);
    expect(res.approvals.length).toBe(0);
    expect(res.steps.length).toBe(1);

    const step = res.steps[0];
    expect(step.key).toBe('l2-base-token:withdraw');
    expect(step.kind).toBe('l2-base-token:withdraw');

    if (kind === 'ethers') {
      const tx = step.tx as any;
      expect((tx.to as string).toLowerCase()).toBe(L2_BASE_TOKEN_ADDRESS.toLowerCase());
      expect((tx.from as string).toLowerCase()).toBe(ctx.sender.toLowerCase());
      expect(BigInt(tx.value ?? 0n)).toBe(amount);
      expect(decodeBaseTokenWithdraw(tx.data)).toBe(ctx.sender.toLowerCase());
      expect(tx.gasLimit).toBe((200_000n * 115n) / 100n);
    } else {
      const tx = step.tx as any;
      expect((tx.address as string).toLowerCase()).toBe(L2_BASE_TOKEN_ADDRESS.toLowerCase());
      expect((tx.account as string).toLowerCase()).toBe(ctx.sender.toLowerCase());
      expect(BigInt(tx.value ?? 0n)).toBe(amount);
      const args = tx.args as unknown[];
      expect(((args?.[0] as string) ?? '').toLowerCase()).toBe(ctx.sender.toLowerCase());
    }
  });

  it('uses provided recipient when supplied', async () => {
    const harness = factory();
    const ctx = makeWithdrawalContext(harness);
    const to = '0x5555555555555555555555555555555555555555';

    if (kind === 'ethers') {
      harness.setL2EstimateGas(150_000n);
    } else {
      harness.setSimulateResponse(
        {
          request: {
            address: L2_BASE_TOKEN_ADDRESS,
            abi: IBaseTokenABI,
            functionName: 'withdraw',
            args: [to],
            value: 0n,
            account: (ctx.client as any).account,
          },
        },
        'l2',
      );
    }

    const res = await ROUTES[kind].build({ amount: 0n, to } as any, ctx as any);
    const step = res.steps[0];

    if (kind === 'ethers') {
      expect(decodeBaseTokenWithdraw((step.tx as any).data)).toBe(to.toLowerCase());
    } else {
      const args = (step.tx as any).args as unknown[];
      expect(((args?.[0] as string) ?? '').toLowerCase()).toBe(to.toLowerCase());
    }
  });

  if (kind === 'ethers') {
    it('tolerates estimateGas failures by omitting gasLimit', async () => {
      const harness = factory();
      const ctx = makeWithdrawalContext(harness);
      harness.setL2EstimateGas(new Error('boom'));

      const res = await ROUTES.ethers.build({ amount: 1n } as any, ctx as any);
      expect((res.steps[0].tx as any).gasLimit).toBeUndefined();
    });
  } else {
    it('wraps simulation failures as ZKsyncError', async () => {
      const harness = factory();
      const ctx = makeWithdrawalContext(harness);
      harness.setSimulateError(new Error('fail'), 'l2');

      let caught: unknown;
      try {
        await ROUTES.viem.build({ amount: 1n } as any, ctx as any);
      } catch (err) {
        caught = err;
      }
      expect(isZKsyncError(caught)).toBe(true);
      expect(String(caught)).toMatch(/Failed to simulate L2 ETH withdraw/);
    });
  }
});
