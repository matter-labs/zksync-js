import { describe, expect, it } from 'bun:test';

import { applyPriorityL2GasLimitBuffer } from '../priority';

describe('deposit/priority applyPriorityL2GasLimitBuffer', () => {
  it('applies a 30% priority gas buffer on EraVM chains', () => {
    expect(
      applyPriorityL2GasLimitBuffer({
        chainIdL2: 11124n,
        gasLimit: 253_884n,
      }),
    ).toBe(330_049n);
  });

  it('does not change the priority gas limit on non-EraVM chains', () => {
    expect(
      applyPriorityL2GasLimitBuffer({
        chainIdL2: 325n,
        gasLimit: 253_884n,
      }),
    ).toBe(253_884n);
  });
});
