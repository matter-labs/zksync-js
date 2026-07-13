import { describe, expect, it } from 'bun:test';
import type { InteropAction } from '../../../types/flows/interop';
import { pickInteropRoute, sumActionMsgValue, sumErc20Amounts, type InteropCtx } from '../route';

const ADDRESS_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const ADDRESS_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const TOKEN = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const RECOVERY = { protocol: 'IAtomicRecoverable' } as const;

const context = (overrides: Partial<InteropCtx> = {}): InteropCtx => ({
  sender: ADDRESS_A,
  srcChainId: 1n,
  dstChainId: 2n,
  baseTokenSrc: ADDRESS_A,
  baseTokenDst: ADDRESS_B,
  ...overrides,
});

describe('atomic interop route selection', () => {
  it('never contributes native value', () => {
    const actions: InteropAction[] = [
      { type: 'call', to: ADDRESS_A, data: '0x1234', recovery: RECOVERY },
      { type: 'sendErc20', token: TOKEN, to: ADDRESS_B, amount: 10n },
    ];
    expect(sumActionMsgValue(actions)).toBe(0n);
  });

  it('sums only ERC-20 transfer amounts', () => {
    const actions: InteropAction[] = [
      { type: 'sendErc20', token: TOKEN, to: ADDRESS_A, amount: 10n },
      { type: 'sendErc20', token: TOKEN, to: ADDRESS_B, amount: 20n },
      { type: 'call', to: ADDRESS_A, data: '0x', recovery: RECOVERY },
    ];
    expect(sumErc20Amounts(actions)).toBe(30n);
  });

  it('uses the direct route for recoverable calls regardless of base-token pairing', () => {
    const actions: InteropAction[] = [
      { type: 'call', to: ADDRESS_A, data: '0x', recovery: RECOVERY },
    ];
    expect(pickInteropRoute({ actions, ctx: context() })).toBe('direct');
  });

  it('uses the indirect route when any ERC-20 burn is present', () => {
    const actions: InteropAction[] = [
      { type: 'call', to: ADDRESS_A, data: '0x', recovery: RECOVERY },
      { type: 'sendErc20', token: TOKEN, to: ADDRESS_B, amount: 10n },
    ];
    expect(pickInteropRoute({ actions, ctx: context() })).toBe('indirect');
  });
});
