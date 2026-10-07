import { describe, expect, it } from 'bun:test';

import type { GasEstimator } from '../../../adapters/interfaces';
import { quoteL1Fees, quoteL1Gas, quoteL2Gas, resolveCreateDepositL1GasLimit } from '../gas';

describe('deposit/gas resolveCreateDepositL1GasLimit', () => {
  it('keeps the prepared bridge gas floor on EraVM chains', () => {
    expect(
      resolveCreateDepositL1GasLimit({
        chainIdL2: 324n,
        stepKey: 'bridgehub:direct',
        preparedGasLimit: 240_000n,
        estimatedGasLimit: 100_000n,
      }),
    ).toBe(240_000n);
  });

  it('uses the shared 20% buffer for EraVM bridge steps when no prepared gas exists', () => {
    expect(
      resolveCreateDepositL1GasLimit({
        chainIdL2: 324n,
        stepKey: 'bridgehub:direct',
        estimatedGasLimit: 100_000n,
      }),
    ).toBe(120_000n);
  });

  it('keeps the 15% create-time buffer on non-EraVM chains', () => {
    expect(
      resolveCreateDepositL1GasLimit({
        chainIdL2: 325n,
        stepKey: 'bridgehub:direct',
        preparedGasLimit: 240_000n,
        estimatedGasLimit: 100_000n,
      }),
    ).toBe(115_000n);
  });

  it('does not change approval-step buffering on EraVM chains', () => {
    expect(
      resolveCreateDepositL1GasLimit({
        chainIdL2: 324n,
        stepKey:
          'approve:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222',
        estimatedGasLimit: 100_000n,
      }),
    ).toBe(115_000n);
  });
});

// Sepolia right after the base fee collapsed: ~32 wei base fee, 875_000 wei suggested tip.
const MARKET = { maxFeePerGas: 875_065n, maxPriorityFeePerGas: 875_000n };

function marketEstimator(market = MARKET): GasEstimator & { feeCalls: number } {
  const estimator = {
    feeCalls: 0,
    async estimateFeesPerGas() {
      estimator.feeCalls++;
      return market;
    },
    async estimateGas() {
      return 0n;
    },
    async getGasPrice() {
      return market.maxFeePerGas;
    },
    async call() {
      return '0x';
    },
  };
  return estimator;
}

describe('deposit/gas quoteL1Fees', () => {
  it('uses market fees when nothing is overridden', async () => {
    expect(await quoteL1Fees({ estimator: marketEstimator() })).toEqual(MARKET);
  });

  it('accepts a successful zero-fee estimate', async () => {
    const fees = { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n };
    expect(await quoteL1Fees({ estimator: marketEstimator(fees) })).toEqual(fees);
  });

  it('accepts a successful zero gas-price fallback', async () => {
    const estimator: GasEstimator = {
      ...marketEstimator(),
      async estimateFeesPerGas() {
        return {};
      },
      async getGasPrice() {
        return 0n;
      },
    };
    expect(await quoteL1Fees({ estimator })).toEqual({
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
    });
  });

  it('raises maxFeePerGas by the overridden tip so the base cost covers it', async () => {
    const fees = await quoteL1Fees({
      estimator: marketEstimator(),
      overrides: { maxPriorityFeePerGas: 1_000_000n } as any,
    });
    // market headroom (875_065 - 875_000) on top of the tip actually paid
    expect(fees).toEqual({ maxFeePerGas: 1_000_065n, maxPriorityFeePerGas: 1_000_000n });
  });

  it('caps the market tip at an overridden maxFeePerGas', async () => {
    const fees = await quoteL1Fees({
      estimator: marketEstimator(),
      overrides: { maxFeePerGas: 500_000n } as any,
    });
    expect(fees).toEqual({ maxFeePerGas: 500_000n, maxPriorityFeePerGas: 500_000n });
  });

  it('uses both overrides as given without querying the market', async () => {
    const estimator = marketEstimator();
    const fees = await quoteL1Fees({
      estimator,
      overrides: { maxFeePerGas: 3n, maxPriorityFeePerGas: 2n } as any,
    });
    expect(fees).toEqual({ maxFeePerGas: 3n, maxPriorityFeePerGas: 2n });
    expect(estimator.feeCalls).toBe(0);
  });

  for (const overrides of [undefined, { maxPriorityFeePerGas: 0n }]) {
    it(`throws when fee discovery fails ${overrides ? 'with only a tip override' : 'without overrides'}`, async () => {
      const estimator: GasEstimator = {
        ...marketEstimator(),
        async estimateFeesPerGas() {
          return {};
        },
        async getGasPrice() {
          throw new Error('no gas price');
        },
      };
      await expect(quoteL1Fees({ estimator, overrides: overrides as any })).rejects.toThrow(
        /Could not fetch L1 gas price/,
      );
    });
  }
});

describe('deposit/gas fee discovery fallback', () => {
  it('keeps gas quotes available when fee discovery fails', async () => {
    const estimator: GasEstimator = {
      ...marketEstimator(),
      async estimateFeesPerGas() {
        throw new Error('no fee estimate');
      },
      async getGasPrice() {
        throw new Error('no gas price');
      },
      async estimateGas() {
        return 100n;
      },
    };
    const tx = { to: '0x1111111111111111111111111111111111111111' as const };
    expect(await quoteL1Gas({ estimator, tx })).toMatchObject({
      gasLimit: 120n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      maxCost: 0n,
    });
    expect(
      await quoteL2Gas({ estimator, route: 'eth-base', overrideGasLimit: 100n }),
    ).toMatchObject({ gasLimit: 100n, maxFeePerGas: 0n, maxCost: 0n });
  });
});
