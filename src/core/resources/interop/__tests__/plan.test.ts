// tests/interop/plan.test.ts
import { describe, it, expect } from 'bun:test';
import {
  preflightDirect,
  buildDirectBundle,
  preflightIndirect,
  buildIndirectBundle,
} from '../plan';
import type { InteropBuildCtx, InteropAttributes, InteropStarterData } from '../plan';
import type { InteropAction, InteropParams } from '../../../types/flows/interop';
import type { Address, Hex } from '../../../types/primitives';
import { assertNever } from '../../../utils/index';

const ADDR_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const ADDR_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const TOKEN = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const L2_ASSET_ROUTER = '0xdddddddddddddddddddddddddddddddddddddddd' as const;
const L2_NTV = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const;

const mockCodec = {
  formatChain: (chainId: bigint): Hex => `0x${chainId.toString(16).padStart(64, '0')}` as Hex,
  formatAddress: (address: Address): Hex => address.toLowerCase() as Hex,
};

const baseCtx = (opts: Partial<InteropBuildCtx> = {}): InteropBuildCtx => ({
  dstChainId: 2n,
  baseTokens: { src: ADDR_A, dst: ADDR_A },
  l2AssetRouter: L2_ASSET_ROUTER,
  l2NativeTokenVault: L2_NTV,
  codec: mockCodec,
  ...opts,
});

const emptyAttrs: InteropAttributes = {
  bundleAttributes: [],
  callAttributes: [],
};

// Helper to verify exhaustiveness of InteropAction type at compile time
function actionTypeToString(action: InteropAction): string {
  switch (action.type) {
    case 'sendNative':
      return 'sendNative';
    case 'sendErc20':
      return 'sendErc20';
    case 'call':
      return 'call';
    default:
      return assertNever(action);
  }
}

describe('interop/plan', () => {
  describe('InteropAction exhaustiveness', () => {
    it('handles all action type variants', () => {
      const actions: InteropAction[] = [
        { type: 'sendNative', to: ADDR_A, amount: 100n },
        { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
        { type: 'call', to: ADDR_A, data: '0x' },
      ];
      expect(actions.map(actionTypeToString)).toEqual(['sendNative', 'sendErc20', 'call']);
    });
  });

  describe('preflightDirect', () => {
    it('throws for empty actions', () => {
      const params: InteropParams = { dstChainId: 2n, actions: [] };
      expect(() => preflightDirect(params, baseCtx())).toThrow(
        'route "direct" requires at least one action.',
      );
    });

    it('throws when ERC-20 actions are present', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n }],
      };
      expect(() => preflightDirect(params, baseCtx())).toThrow(
        'route "direct" does not support sendErc20 actions',
      );
    });

    it('throws when base tokens differ', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendNative', to: ADDR_A, amount: 100n }],
      };
      const ctx = baseCtx({ baseTokens: { src: ADDR_A, dst: ADDR_B } });
      expect(() => preflightDirect(params, ctx)).toThrow(
        'route "direct" requires matching base tokens',
      );
    });

    it('throws for negative sendNative amount', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendNative', to: ADDR_A, amount: -1n }],
      };
      expect(() => preflightDirect(params, baseCtx())).toThrow('sendNative.amount must be >= 0');
    });

    it('throws for negative call value', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'call', to: ADDR_A, data: '0x', value: -1n }],
      };
      expect(() => preflightDirect(params, baseCtx())).toThrow('call.value must be >= 0');
    });

    it('passes for valid direct route params', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [
          { type: 'sendNative', to: ADDR_A, amount: 100n },
          { type: 'call', to: ADDR_B, data: '0xabcd', value: 50n },
        ],
      };
      expect(() => preflightDirect(params, baseCtx())).not.toThrow();
    });

    it('allows call without value', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'call', to: ADDR_A, data: '0x' }],
      };
      expect(() => preflightDirect(params, baseCtx())).not.toThrow();
    });
  });

  describe('buildDirectBundle', () => {
    it('builds bundle for sendNative actions', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendNative', to: ADDR_A, amount: 100n }],
      };
      const result = buildDirectBundle(params, baseCtx(), emptyAttrs);

      expect(result.starters).toHaveLength(1);
      expect(result.starters[0][0]).toBe(ADDR_A.toLowerCase());
      expect(result.starters[0][1]).toBe('0x');
      expect(result.quoteExtras.totalActionValue).toBe(100n);
      expect(result.quoteExtras.bridgedTokenTotal).toBe(0n);
      expect(result.approvals).toHaveLength(0);
    });

    it('builds bundle for call actions', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'call', to: ADDR_A, data: '0xabcdef', value: 50n }],
      };
      const result = buildDirectBundle(params, baseCtx(), emptyAttrs);

      expect(result.starters).toHaveLength(1);
      expect(result.starters[0][0]).toBe(ADDR_A.toLowerCase());
      expect(result.starters[0][1]).toBe('0xabcdef');
      expect(result.quoteExtras.totalActionValue).toBe(50n);
    });

    it('includes call attributes in starters', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendNative', to: ADDR_A, amount: 100n }],
      };
      const attrs: InteropAttributes = {
        bundleAttributes: ['0xbundle1'],
        callAttributes: [['0xcall1', '0xcall2']],
      };
      const result = buildDirectBundle(params, baseCtx(), attrs);

      expect(result.starters[0][2]).toEqual(['0xcall1', '0xcall2']);
      expect(result.bundleAttributes).toEqual(['0xbundle1']);
    });

    it('handles call without data', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'call', to: ADDR_A, data: undefined as unknown as Hex }],
      };
      const result = buildDirectBundle(params, baseCtx(), emptyAttrs);

      expect(result.starters[0][1]).toBe('0x');
    });
  });

  describe('preflightIndirect', () => {
    it('throws for empty actions', () => {
      const params: InteropParams = { dstChainId: 2n, actions: [] };
      expect(() => preflightIndirect(params, baseCtx())).toThrow(
        'route "indirect" requires at least one action.',
      );
    });

    it('throws when no ERC-20 and base tokens match', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendNative', to: ADDR_A, amount: 100n }],
      };
      expect(() => preflightIndirect(params, baseCtx())).toThrow(
        'route "indirect" requires ERC-20 actions or mismatched base tokens',
      );
    });

    it('passes for ERC-20 actions with matching base tokens', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n }],
      };
      expect(() => preflightIndirect(params, baseCtx())).not.toThrow();
    });

    it('passes for mismatched base tokens without ERC-20', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendNative', to: ADDR_A, amount: 100n }],
      };
      const ctx = baseCtx({ baseTokens: { src: ADDR_A, dst: ADDR_B } });
      expect(() => preflightIndirect(params, ctx)).not.toThrow();
    });

    it('throws for negative sendNative amount', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [
          { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
          { type: 'sendNative', to: ADDR_A, amount: -1n },
        ],
      };
      expect(() => preflightIndirect(params, baseCtx())).toThrow('sendNative.amount must be >= 0');
    });

    it('throws for negative sendErc20 amount', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: -1n }],
      };
      expect(() => preflightIndirect(params, baseCtx())).toThrow('sendErc20.amount must be >= 0');
    });

    it('throws for negative call value', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [
          { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
          { type: 'call', to: ADDR_A, data: '0x', value: -1n },
        ],
      };
      expect(() => preflightIndirect(params, baseCtx())).toThrow('call.value must be >= 0');
    });

    it('throws for call.value > 0 when base tokens differ', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'call', to: ADDR_A, data: '0x', value: 100n }],
      };
      const ctx = baseCtx({ baseTokens: { src: ADDR_A, dst: ADDR_B } });
      expect(() => preflightIndirect(params, ctx)).toThrow(
        'indirect route does not support call.value when base tokens differ',
      );
    });

    it('allows call.value = 0 when base tokens differ', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'call', to: ADDR_A, data: '0x', value: 0n }],
      };
      const ctx = baseCtx({ baseTokens: { src: ADDR_A, dst: ADDR_B } });
      expect(() => preflightIndirect(params, ctx)).not.toThrow();
    });
  });

  describe('buildIndirectBundle', () => {
    it('builds bundle with ERC-20 approvals', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [
          { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
          { type: 'sendErc20', token: ADDR_B, to: ADDR_A, amount: 200n },
        ],
      };
      const starterData: InteropStarterData[] = [
        { assetRouterPayload: '0xpayload1' },
        { assetRouterPayload: '0xpayload2' },
      ];
      const result = buildIndirectBundle(params, baseCtx(), emptyAttrs, starterData);

      expect(result.approvals).toHaveLength(2);
      expect(result.approvals[0]).toEqual({
        token: TOKEN,
        spender: L2_NTV,
        amount: 100n,
      });
      expect(result.approvals[1]).toEqual({
        token: ADDR_B,
        spender: L2_NTV,
        amount: 200n,
      });
      expect(result.quoteExtras.bridgedTokenTotal).toBe(300n);
    });

    it('routes ERC-20 actions via asset router', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n }],
      };
      const starterData: InteropStarterData[] = [{ assetRouterPayload: '0xpayload' }];
      const result = buildIndirectBundle(params, baseCtx(), emptyAttrs, starterData);

      expect(result.starters[0][0]).toBe(L2_ASSET_ROUTER.toLowerCase());
      expect(result.starters[0][1]).toBe('0xpayload');
    });

    it('throws when sendErc20 action is missing asset router payload', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n }],
      };
      const starterData: InteropStarterData[] = [{}];

      expect(() => buildIndirectBundle(params, baseCtx(), emptyAttrs, starterData)).toThrow(
        'buildIndirectBundle: missing assetRouterPayload for sendErc20 action.',
      );
    });

    it('routes sendNative with matching base tokens directly', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [
          { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
          { type: 'sendNative', to: ADDR_B, amount: 50n },
        ],
      };
      const starterData: InteropStarterData[] = [{ assetRouterPayload: '0xpayload' }, {}];
      const result = buildIndirectBundle(params, baseCtx(), emptyAttrs, starterData);

      expect(result.starters[1][0]).toBe(ADDR_B.toLowerCase());
      expect(result.starters[1][1]).toBe('0x');
      expect(result.quoteExtras.totalActionValue).toBe(50n);
    });

    it('handles call actions', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [
          { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
          { type: 'call', to: ADDR_B, data: '0xabcdef', value: 25n },
        ],
      };
      const starterData: InteropStarterData[] = [{ assetRouterPayload: '0xpayload' }, {}];
      const result = buildIndirectBundle(params, baseCtx(), emptyAttrs, starterData);

      expect(result.starters[1][0]).toBe(ADDR_B.toLowerCase());
      expect(result.starters[1][1]).toBe('0xabcdef');
      expect(result.quoteExtras.totalActionValue).toBe(25n);
    });

    it('includes call attributes', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [{ type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n }],
      };
      const attrs: InteropAttributes = {
        bundleAttributes: ['0xbundle'],
        callAttributes: [['0xcall1']],
      };
      const starterData: InteropStarterData[] = [{ assetRouterPayload: '0xpayload' }];
      const result = buildIndirectBundle(params, baseCtx(), attrs, starterData);

      expect(result.starters[0][2]).toEqual(['0xcall1']);
      expect(result.bundleAttributes).toEqual(['0xbundle']);
    });

    it('handles call without data', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [
          { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
          { type: 'call', to: ADDR_B, data: undefined as unknown as Hex },
        ],
      };
      const starterData: InteropStarterData[] = [{ assetRouterPayload: '0xpayload' }, {}];
      const result = buildIndirectBundle(params, baseCtx(), emptyAttrs, starterData);

      expect(result.starters[1][1]).toBe('0x');
    });

    it('aggregates approvals for same token', () => {
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [
          { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
          { type: 'sendErc20', token: TOKEN, to: ADDR_B, amount: 200n },
          { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 50n },
        ],
      };
      const starterData: InteropStarterData[] = [
        { assetRouterPayload: '0xpayload1' },
        { assetRouterPayload: '0xpayload2' },
        { assetRouterPayload: '0xpayload3' },
      ];
      const result = buildIndirectBundle(params, baseCtx(), emptyAttrs, starterData);

      expect(result.approvals).toHaveLength(1);
      expect(result.approvals[0]).toEqual({
        token: TOKEN,
        spender: L2_NTV,
        amount: 350n,
      });
    });

    it('aggregates approvals case-insensitively', () => {
      const tokenLower = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
      const tokenUpper = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' as const;
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [
          { type: 'sendErc20', token: tokenLower, to: ADDR_A, amount: 100n },
          { type: 'sendErc20', token: tokenUpper, to: ADDR_B, amount: 200n },
        ],
      };
      const starterData: InteropStarterData[] = [
        { assetRouterPayload: '0xpayload1' },
        { assetRouterPayload: '0xpayload2' },
      ];
      const result = buildIndirectBundle(params, baseCtx(), emptyAttrs, starterData);

      expect(result.approvals).toHaveLength(1);
      expect(result.approvals[0].amount).toBe(300n);
    });

    it('aggregates same tokens while keeping different tokens separate', () => {
      const TOKEN_2 = '0x1111111111111111111111111111111111111111' as const;
      const params: InteropParams = {
        dstChainId: 2n,
        actions: [
          { type: 'sendErc20', token: TOKEN, to: ADDR_A, amount: 100n },
          { type: 'sendErc20', token: TOKEN_2, to: ADDR_A, amount: 50n },
          { type: 'sendErc20', token: TOKEN, to: ADDR_B, amount: 200n },
          { type: 'sendErc20', token: TOKEN_2, to: ADDR_B, amount: 75n },
        ],
      };
      const starterData: InteropStarterData[] = [
        { assetRouterPayload: '0xpayload1' },
        { assetRouterPayload: '0xpayload2' },
        { assetRouterPayload: '0xpayload3' },
        { assetRouterPayload: '0xpayload4' },
      ];
      const result = buildIndirectBundle(params, baseCtx(), emptyAttrs, starterData);

      expect(result.approvals).toHaveLength(2);
      const tokenApproval = result.approvals.find(
        (a) => a.token.toLowerCase() === TOKEN.toLowerCase(),
      );
      const token2Approval = result.approvals.find(
        (a) => a.token.toLowerCase() === TOKEN_2.toLowerCase(),
      );
      expect(tokenApproval?.amount).toBe(300n);
      expect(token2Approval?.amount).toBe(125n);
    });
  });
});
