// tests/interop/route.test.ts
import { describe, it, expect } from 'bun:test';
import { sumActionMsgValue, sumErc20Amounts, pickInteropRoute } from '../route';
import type { InteropAction } from '../../../types/flows/interop';
import type { InteropCtx } from '../route';

const ADDR_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const ADDR_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const TOKEN = '0xcccccccccccccccccccccccccccccccccccccccc' as const;

describe('interop/route', () => {
  describe('sumActionMsgValue', () => {
    it('returns 0n for empty actions array', () => {
      expect(sumActionMsgValue([])).toBe(0n);
    });

    it('sums sendNative amounts', () => {
      const actions: InteropAction[] = [
        { type: 'sendNative', to: ADDR_A, amount: 100n },
        { type: 'sendNative', to: ADDR_B, amount: 200n },
      ];
      expect(sumActionMsgValue(actions)).toBe(300n);
    });

    it('sums call values', () => {
      const actions: InteropAction[] = [
        { type: 'call', to: ADDR_A, data: '0x', value: 50n },
        { type: 'call', to: ADDR_B, data: '0x', value: 150n },
      ];
      expect(sumActionMsgValue(actions)).toBe(200n);
    });

    it('ignores call without value', () => {
      const actions: InteropAction[] = [
        { type: 'call', to: ADDR_A, data: '0x' },
        { type: 'call', to: ADDR_B, data: '0x', value: 100n },
      ];
      expect(sumActionMsgValue(actions)).toBe(100n);
    });

    it('ignores sendErc20 actions', () => {
      const actions: InteropAction[] = [
        { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 1000n },
        { type: 'sendNative', to: ADDR_B, amount: 50n },
      ];
      expect(sumActionMsgValue(actions)).toBe(50n);
    });

    it('sums mixed action types correctly', () => {
      const actions: InteropAction[] = [
        { type: 'sendNative', to: ADDR_A, amount: 100n },
        { type: 'sendErc20', token: TOKEN, to: ADDR_B, amount: 500n },
        { type: 'call', to: ADDR_A, data: '0x', value: 200n },
        { type: 'call', to: ADDR_B, data: '0x' },
      ];
      expect(sumActionMsgValue(actions)).toBe(300n);
    });
  });

  describe('sumErc20Amounts', () => {
    it('returns 0n for empty actions array', () => {
      expect(sumErc20Amounts([])).toBe(0n);
    });

    it('sums sendErc20 amounts', () => {
      const actions: InteropAction[] = [
        { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
        { type: 'sendErc20', token: TOKEN, to: ADDR_B, amount: 200n },
      ];
      expect(sumErc20Amounts(actions)).toBe(300n);
    });

    it('ignores non-sendErc20 actions', () => {
      const actions: InteropAction[] = [
        { type: 'sendNative', to: ADDR_A, amount: 1000n },
        { type: 'sendErc20', token: TOKEN, to: ADDR_B, amount: 50n },
        { type: 'call', to: ADDR_A, data: '0x', value: 500n },
      ];
      expect(sumErc20Amounts(actions)).toBe(50n);
    });
  });

  describe('pickInteropRoute', () => {
    const baseCtx = (opts: Partial<InteropCtx> = {}): InteropCtx => ({
      sender: ADDR_A,
      srcChainId: 1n,
      dstChainId: 2n,
      baseTokenSrc: ADDR_A,
      baseTokenDst: ADDR_A,
      ...opts,
    });

    it('returns direct for sendNative with matching base tokens', () => {
      const actions: InteropAction[] = [{ type: 'sendNative', to: ADDR_A, amount: 100n }];
      expect(pickInteropRoute({ actions, ctx: baseCtx() })).toBe('direct');
    });

    it('returns direct for call with matching base tokens', () => {
      const actions: InteropAction[] = [{ type: 'call', to: ADDR_A, data: '0x', value: 50n }];
      expect(pickInteropRoute({ actions, ctx: baseCtx() })).toBe('direct');
    });

    it('returns indirect when ERC-20 is present', () => {
      const actions: InteropAction[] = [
        { type: 'sendNative', to: ADDR_A, amount: 100n },
        { type: 'sendErc20', token: TOKEN, to: ADDR_B, amount: 50n },
      ];
      expect(pickInteropRoute({ actions, ctx: baseCtx() })).toBe('indirect');
    });

    it('returns indirect when base tokens differ', () => {
      const actions: InteropAction[] = [{ type: 'sendNative', to: ADDR_A, amount: 100n }];
      const ctx = baseCtx({ baseTokenDst: ADDR_B });
      expect(pickInteropRoute({ actions, ctx })).toBe('indirect');
    });

    it('returns indirect with ERC-20 even if base tokens match', () => {
      const actions: InteropAction[] = [
        { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
      ];
      expect(pickInteropRoute({ actions, ctx: baseCtx() })).toBe('indirect');
    });

    it('handles case-insensitive base token comparison', () => {
      const actions: InteropAction[] = [{ type: 'sendNative', to: ADDR_A, amount: 100n }];
      const ctx = baseCtx({
        baseTokenSrc: ADDR_A.toLowerCase() as `0x${string}`,
        baseTokenDst: ADDR_A.toUpperCase() as `0x${string}`,
      });
      expect(pickInteropRoute({ actions, ctx })).toBe('direct');
    });
  });
});
