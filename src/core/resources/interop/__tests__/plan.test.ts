import { describe, expect, it } from 'bun:test';
import type { InteropParams } from '../../../types/flows/interop';
import type { Address, Hex } from '../../../types/primitives';
import {
  buildDirectBundle,
  buildIndirectBundle,
  preflightDirect,
  preflightIndirect,
  type InteropAttributes,
  type InteropBuildCtx,
  type InteropFeeInfo,
} from '../plan';

const ADDRESS_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const ADDRESS_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const TOKEN = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const ASSET_ROUTER = '0xdddddddddddddddddddddddddddddddddddddddd' as const;
const NTV = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const;
const RECOVERY = { protocol: 'IAtomicRecoverable' } as const;

const context: InteropBuildCtx = {
  dstChainId: 2n,
  baseTokens: { src: ADDRESS_A, dst: ADDRESS_B },
  l2AssetRouter: ASSET_ROUTER,
  l2NativeTokenVault: NTV,
  codec: {
    formatChain: (chainId: bigint) => `0x${chainId.toString(16).padStart(64, '0')}` as Hex,
    formatAddress: (address: Address) => address.toLowerCase() as Hex,
  },
};
const attributes: InteropAttributes = {
  bundleAttributes: ['0x1234'],
  callAttributes: [['0xabcd'], ['0xef01']],
};
const fee: InteropFeeInfo = {
  approval: null,
  fee: { token: ADDRESS_A, amount: 0n },
};

const params = (actions: InteropParams['actions']): InteropParams => ({
  actions,
  deadline: 1_900_000_000n,
});

describe('atomic interop bundle planning', () => {
  it('builds a zero-value direct recoverable call', () => {
    const input = params([{ type: 'call', to: ADDRESS_A, data: '0x1122', recovery: RECOVERY }]);
    expect(() => preflightDirect(input, context)).not.toThrow();
    const bundle = buildDirectBundle(input, context, attributes, fee);
    expect(bundle.starters).toEqual([[ADDRESS_A, '0x1122', ['0xabcd']]]);
    expect(bundle.quoteExtras).toEqual({ totalActionValue: 0n, bridgedTokenTotal: 0n });
  });

  it('rejects ERC-20 actions on the direct route', () => {
    const input = params([{ type: 'sendErc20', token: TOKEN, to: ADDRESS_A, amount: 1n }]);
    expect(() => preflightDirect(input, context)).toThrow(/does not support sendErc20/);
  });

  it('requires an ERC-20 action on the indirect route', () => {
    const input = params([{ type: 'call', to: ADDRESS_A, data: '0x', recovery: RECOVERY }]);
    expect(() => preflightIndirect(input, context)).toThrow(/requires at least one ERC-20/);
  });

  it('rejects zero ERC-20 amounts', () => {
    const input = params([{ type: 'sendErc20', token: TOKEN, to: ADDRESS_A, amount: 0n }]);
    expect(() => preflightIndirect(input, context)).toThrow(/greater than zero/);
  });

  it('aggregates ERC-20 approvals and routes burns through L2AssetRouter', () => {
    const input = params([
      { type: 'sendErc20', token: TOKEN, to: ADDRESS_A, amount: 10n },
      { type: 'sendErc20', token: TOKEN, to: ADDRESS_B, amount: 20n },
    ]);
    preflightIndirect(input, context);
    const bundle = buildIndirectBundle(
      input,
      context,
      attributes,
      [{ assetRouterPayload: '0x1111' }, { assetRouterPayload: '0x2222' }],
      fee,
    );
    expect(bundle.approvals).toEqual([{ token: TOKEN, spender: NTV, amount: 30n }]);
    expect(bundle.starters).toEqual([
      [ASSET_ROUTER, '0x1111', ['0xabcd']],
      [ASSET_ROUTER, '0x2222', ['0xef01']],
    ]);
    expect(bundle.quoteExtras).toEqual({ totalActionValue: 0n, bridgedTokenTotal: 30n });
  });

  it('keeps zero-value recoverable calls direct inside a mixed bundle', () => {
    const input = params([
      { type: 'sendErc20', token: TOKEN, to: ADDRESS_A, amount: 10n },
      { type: 'call', to: ADDRESS_B, data: '0x3344', recovery: RECOVERY },
    ]);
    const bundle = buildIndirectBundle(
      input,
      context,
      attributes,
      [{ assetRouterPayload: '0x1111' }, {}],
      fee,
    );
    expect(bundle.starters[1]).toEqual([ADDRESS_B, '0x3344', ['0xef01']]);
  });
});
