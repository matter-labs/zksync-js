import { describe, expect, it } from 'bun:test';

import { resolveCreateDepositL1GasLimit } from '../gas';

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
