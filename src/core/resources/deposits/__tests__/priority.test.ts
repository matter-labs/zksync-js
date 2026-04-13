import { describe, expect, it } from 'bun:test';

import { applyPriorityL2GasLimitBuffer } from '../priority';

describe('deposit/priority applyPriorityL2GasLimitBuffer', () => {
  it('applies a 40% priority gas buffer on EraVM chains', () => {
    expect(
      applyPriorityL2GasLimitBuffer({
        chainIdL2: 11124n,
        gasLimit: 253_884n,
      }),
    ).toBe(355_437n);
  });

  it('applies a 40% priority gas buffer on non-EraVM chains', () => {
    expect(
      applyPriorityL2GasLimitBuffer({
        chainIdL2: 11124n,
        gasLimit: 253_884n,
      }),
    ).toBe(355_437n);
  });
});
