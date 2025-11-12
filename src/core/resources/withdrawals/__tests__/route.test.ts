// tests/withdrawals/route.test.ts
import { describe, it, expect } from 'bun:test';
import { pickWithdrawRoute } from '../route';
import { ETH_ADDRESS, L2_BASE_TOKEN_ADDRESS } from '../../../constants';

describe('withdrawals/pickWithdrawRoute', () => {
  it('returns eth-base / eth-nonbase for ETH sentinel', () => {
    expect(pickWithdrawRoute({ token: ETH_ADDRESS, baseIsEth: true })).toBe('eth-base');
    expect(pickWithdrawRoute({ token: ETH_ADDRESS, baseIsEth: false })).toBe('eth-nonbase');
  });

  it('returns eth-base / eth-nonbase for L2 base-token alias (0x…800A)', () => {
    expect(pickWithdrawRoute({ token: L2_BASE_TOKEN_ADDRESS, baseIsEth: true })).toBe('eth-base');
    expect(pickWithdrawRoute({ token: L2_BASE_TOKEN_ADDRESS, baseIsEth: false })).toBe(
      'eth-nonbase',
    );

    // case-insensitive
    expect(
      pickWithdrawRoute({
        token: L2_BASE_TOKEN_ADDRESS.toLowerCase() as `0x${string}`,
        baseIsEth: false,
      }),
    ).toBe('eth-nonbase');
  });

  it('returns erc20-nonbase for any non-ETH token', () => {
    const NON_ETH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
    expect(pickWithdrawRoute({ token: NON_ETH, baseIsEth: true })).toBe('erc20-nonbase');
    expect(pickWithdrawRoute({ token: NON_ETH, baseIsEth: false })).toBe('erc20-nonbase');
  });
});
