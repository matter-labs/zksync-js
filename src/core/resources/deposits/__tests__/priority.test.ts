import { describe, expect, it } from 'bun:test';

import {
  applyPriorityL2GasLimitBuffer,
  clampPriorityL2GasLimit,
  minimalPriorityTxL2Gas,
} from '../priority';

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

describe('deposit/priority minimalPriorityTxL2Gas', () => {
  it('returns the pubdata-bound minimum for empty calldata at gasPerPubdata 800', () => {
    expect(minimalPriorityTxL2Gas({ calldataLength: 0n, gasPerPubdata: 800n })).toBe(281_144n);
  });

  it('scales with gasPerPubdata while the pubdata term dominates', () => {
    expect(minimalPriorityTxL2Gas({ calldataLength: 100n, gasPerPubdata: 2_000n })).toBe(702_344n);
  });

  it('returns the calldata-bound intrinsic minimum once calldata dominates', () => {
    // 21_000 + 40 * 10_000 = 421_000 > 281_144
    expect(minimalPriorityTxL2Gas({ calldataLength: 10_000n, gasPerPubdata: 800n })).toBe(421_000n);
  });
});

describe('deposit/priority clampPriorityL2GasLimit', () => {
  it('raises a gas limit below the protocol minimum', () => {
    expect(
      clampPriorityL2GasLimit({ gasLimit: 253_884n, l2Calldata: '0x', gasPerPubdata: 800n }),
    ).toBe(281_144n);
  });

  it('leaves a gas limit above the protocol minimum untouched', () => {
    expect(
      clampPriorityL2GasLimit({ gasLimit: 355_437n, l2Calldata: '0x', gasPerPubdata: 800n }),
    ).toBe(355_437n);
  });

  it('derives the calldata length from the hex payload', () => {
    const l2Calldata = `0x${'ab'.repeat(10_000)}` as const;
    expect(clampPriorityL2GasLimit({ gasLimit: 1n, l2Calldata, gasPerPubdata: 800n })).toBe(
      421_000n,
    );
  });
});
