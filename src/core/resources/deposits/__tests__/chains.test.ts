import { describe, expect, it } from 'bun:test';

import { isEraVmChain } from '../chains';

describe('deposit/chains', () => {
  it('identifies the supported EraVM chain IDs', () => {
    expect(isEraVmChain(324n)).toBe(true);
    expect(isEraVmChain(2741n)).toBe(true);
    expect(isEraVmChain(11124n)).toBe(true);
    expect(isEraVmChain(300n)).toBe(true);
  });

  it('does not classify OS chains as EraVM', () => {
    expect(isEraVmChain(325n)).toBe(false);
  });
});
