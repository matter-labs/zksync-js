import { describe, it, expect } from 'bun:test';
import { Interface } from 'ethers';

import { routeIndirect as routeEthers } from '../../ethers/resources/interop/routes/indirect.ts';
import { routeIndirect as routeViem } from '../../viem/resources/interop/routes/indirect.ts';
import {
  describeForAdapters,
  makeInteropContext,
  setErc20Allowance,
  setL2TokenRegistration,
  setInteropProtocolFee,
} from '../adapter-harness.ts';
import { parseSendBundleTx } from '../decode-helpers.ts';
import { createEthersAttributesResource } from '../../ethers/resources/interop/attributes/resource.ts';
import { createViemAttributesResource } from '../../viem/resources/interop/attributes/resource.ts';
import { interopCodec as interopCodecEthers } from '../../ethers/resources/interop/address.ts';
import { interopCodec as interopCodecViem } from '../../viem/resources/interop/address.ts';
import {
  IInteropCenterABI,
  IInteropHandlerABI,
  IERC20ABI,
  L2NativeTokenVaultABI,
} from '../../../core/abi.ts';
import { createTokensResource as createEthersTokensResource } from '../../ethers/resources/tokens/index.ts';
import { createTokensResource as createViemTokensResource } from '../../viem/resources/tokens/index.ts';
import type { Hex, Address } from '../../../core/types/primitives.ts';

type AdapterKind = 'ethers' | 'viem';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

const CODECS = {
  ethers: interopCodecEthers,
  viem: interopCodecViem,
} as const;

const TEST_ASSET_ID = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as Hex;

function makeTestBuildCtx(
  kind: AdapterKind,
  harness: any,
  overrides: Record<string, unknown> = {},
) {
  const ctx = makeInteropContext(harness);
  const attributes =
    kind === 'ethers' ? createEthersAttributesResource() : createViemAttributesResource();
  const tokens =
    kind === 'ethers'
      ? createEthersTokensResource(harness.client)
      : createViemTokensResource(harness.client);

  setInteropProtocolFee(harness, ctx.interopCenter, 0n);

  if (kind === 'ethers') {
    const interopCenterIface = new Interface(IInteropCenterABI);
    const interopHandlerIface = new Interface(IInteropHandlerABI);

    return {
      client: harness.client,
      tokens,
      contracts: ctx.contracts as any,
      sender: ctx.sender,
      chainIdL2: ctx.chainId,
      chainId: ctx.chainId,
      bridgehub: ctx.bridgehub,
      dstChainId: ctx.dstChainId,
      dstProvider: harness.l2 as any,
      interopCenter: ctx.interopCenter,
      interopHandler: ctx.interopHandler,
      l2MessageVerification: ctx.l2MessageVerification,
      l2AssetRouter: ctx.l2AssetRouter,
      l2NativeTokenVault: ctx.l2NativeTokenVault,
      baseTokens: ctx.baseTokens,
      ifaces: { interopCenter: interopCenterIface, interopHandler: interopHandlerIface },
      attributes,
      ...overrides,
    };
  }

  return {
    client: harness.client,
    tokens,
    contracts: ctx.contracts as any,
    sender: ctx.sender,
    chainIdL2: ctx.chainId,
    chainId: ctx.chainId,
    bridgehub: ctx.bridgehub,
    dstChainId: ctx.dstChainId,
    dstPublicClient: harness.l2 as any,
    interopCenter: ctx.interopCenter,
    interopHandler: ctx.interopHandler,
    l2MessageVerification: ctx.l2MessageVerification,
    l2AssetRouter: ctx.l2AssetRouter,
    l2NativeTokenVault: ctx.l2NativeTokenVault,
    baseTokens: ctx.baseTokens,
    attributes,
    ...overrides,
  };
}

describeForAdapters('adapters/interop/routeIndirect', (kind, factory) => {
  it('preflight throws when no actions are provided', async () => {
    const harness = factory();
    const buildCtx = makeTestBuildCtx(kind, harness);

    const params = {
      actions: [],
    };

    let caught: unknown;
    try {
      await ROUTES[kind].preflight?.(params, buildCtx as any);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/at least one action/);
  });

  it('preflight throws when no ERC-20 and base tokens match (should use direct)', async () => {
    const harness = factory();
    const buildCtx = makeTestBuildCtx(kind, harness);

    const params = {
      actions: [
        {
          type: 'sendNative' as const,
          to: '0x1111111111111111111111111111111111111111' as Address,
          amount: 100n,
        },
      ],
    };

    let caught: unknown;
    try {
      await ROUTES[kind].preflight?.(params, buildCtx as any);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/ERC-20|direct/i);
  });

  it('builds a sendBundle step for sendNative with mismatched base tokens', async () => {
    const harness = factory();

    const buildCtx = makeTestBuildCtx(kind, harness, {
      baseTokens: {
        src: '0xaaaa000000000000000000000000000000000000' as Address,
        dst: '0xbbbb000000000000000000000000000000000000' as Address,
        matches: false,
      },
    });

    const baseAssetId = '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' as Hex;
    buildCtx.tokens = {
      ...buildCtx.tokens,
      baseTokenAssetId: async () => baseAssetId,
    } as any;

    const recipient = '0x2222222222222222222222222222222222222222' as Address;
    const amount = 1_000_000n;

    const params = {
      actions: [{ type: 'sendNative' as const, to: recipient, amount }],
    };

    const result = await ROUTES[kind].build(params, buildCtx as any);

    expect(result.steps.length).toBe(1);
    expect(result.quoteExtras.totalActionValue).toBe(amount);
    expect(result.quoteExtras.bridgedTokenTotal).toBe(0n);

    const step = result.steps[0];
    expect(step.key).toBe('sendBundle');
    expect(step.kind).toBe('interop.center');

    const decoded = parseSendBundleTx(step.tx);
    expect(decoded.to).toBe(buildCtx.interopCenter.toLowerCase());
    expect(decoded.callStarters.length).toBe(1);
  });

  it('preflight throws when call.value is used with mismatched base tokens', async () => {
    const harness = factory();
    const buildCtx = makeTestBuildCtx(kind, harness, {
      baseTokens: {
        src: '0xaaaa000000000000000000000000000000000000' as Address,
        dst: '0xbbbb000000000000000000000000000000000000' as Address,
        matches: false,
      },
    });

    const params = {
      actions: [
        {
          type: 'call' as const,
          to: '0x1111111111111111111111111111111111111111' as Address,
          data: '0x1234' as Hex,
          value: 100n,
        },
      ],
    };

    let caught: unknown;
    try {
      await ROUTES[kind].preflight?.(params, buildCtx as any);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/call\.value|base tokens/i);
  });

  it('preflight passes for sendNative with negative amount validation', async () => {
    const harness = factory();
    const buildCtx = makeTestBuildCtx(kind, harness, {
      baseTokens: {
        src: '0xaaaa000000000000000000000000000000000000' as Address,
        dst: '0xbbbb000000000000000000000000000000000000' as Address,
        matches: false,
      },
    });

    const params = {
      actions: [
        {
          type: 'sendNative' as const,
          to: '0x1111111111111111111111111111111111111111' as Address,
          amount: -1n,
        },
      ],
    };

    let caught: unknown;
    try {
      await ROUTES[kind].preflight?.(params, buildCtx as any);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/amount must be >= 0/);
  });

  it('encodes destination chain ID correctly in the bundle', async () => {
    const harness = factory();
    const dstChainId = 999n;

    const buildCtx = makeTestBuildCtx(kind, harness, {
      dstChainId,
      baseTokens: {
        src: '0xaaaa000000000000000000000000000000000000' as Address,
        dst: '0xbbbb000000000000000000000000000000000000' as Address,
        matches: false,
      },
    });

    buildCtx.tokens = {
      ...buildCtx.tokens,
      baseTokenAssetId: async () => TEST_ASSET_ID,
    } as any;

    const params = {
      actions: [
        {
          type: 'sendNative' as const,
          to: '0x1111111111111111111111111111111111111111' as Address,
          amount: 100n,
        },
      ],
    };

    const result = await ROUTES[kind].build(params, buildCtx as any);
    const sendBundleStep = result.steps.find((s) => s.key === 'sendBundle');
    const decoded = parseSendBundleTx(sendBundleStep!.tx);

    const expectedDstChain = CODECS[kind].formatChain(dstChainId);
    expect(decoded.destinationChainId).toBe(expectedDstChain);
  });

  it('handles call action without value in indirect route', async () => {
    const harness = factory();
    const buildCtx = makeTestBuildCtx(kind, harness, {
      baseTokens: {
        src: '0xaaaa000000000000000000000000000000000000' as Address,
        dst: '0xbbbb000000000000000000000000000000000000' as Address,
        matches: false,
      },
    });

    buildCtx.tokens = {
      ...buildCtx.tokens,
      baseTokenAssetId: async () => TEST_ASSET_ID,
    } as any;

    const target = '0x3333333333333333333333333333333333333333' as Address;
    const callData = '0xabcdef12' as Hex;

    const params = {
      actions: [
        {
          type: 'sendNative' as const,
          to: '0x1111111111111111111111111111111111111111' as Address,
          amount: 100n,
        },
        { type: 'call' as const, to: target, data: callData },
      ],
    };

    const result = await ROUTES[kind].build(params, buildCtx as any);

    expect(result.steps.length).toBe(1);
    const decoded = parseSendBundleTx(result.steps[0].tx);
    expect(decoded.callStarters.length).toBe(2);

    const callStarter = decoded.callStarters[1];
    expect(callStarter.to).toBe(CODECS[kind].formatAddress(target));
    expect(callStarter.data).toBe(callData);
  });

  it('builds ensure-token and approve steps for ERC-20 actions', async () => {
    const harness = factory();
    const buildCtx = makeTestBuildCtx(kind, harness);

    const token = '0x7777777777777777777777777777777777777777' as Address;
    const amount = 100n;

    setL2TokenRegistration(harness, buildCtx.l2NativeTokenVault, token, TEST_ASSET_ID);
    setErc20Allowance(harness, token, buildCtx.sender, buildCtx.l2NativeTokenVault, 0n);

    const params = {
      actions: [{ type: 'sendErc20' as const, token, to: buildCtx.sender, amount }],
    };

    const result = await ROUTES[kind].build(params, buildCtx as any);
    expect(result.steps.map((s) => s.kind)).toEqual([
      'interop.ntv.ensure-token',
      'approve',
      'interop.center',
    ]);

    const ensureStep = result.steps[0];
    const ntvIface = new Interface(L2NativeTokenVaultABI);
    const ensureArgs = ntvIface.decodeFunctionData(
      'ensureTokenIsRegistered',
      ensureStep.tx.data as Hex,
    );
    expect((ensureArgs[0] as string).toLowerCase()).toBe(token.toLowerCase());

    const approveStep = result.steps[1];
    const erc20Iface = new Interface(IERC20ABI);
    const approveArgs = erc20Iface.decodeFunctionData('approve', approveStep.tx.data as Hex);
    expect((approveArgs[0] as string).toLowerCase()).toBe(
      buildCtx.l2NativeTokenVault.toLowerCase(),
    );
    expect(approveArgs[1]).toBe(amount);
  });

  it('approves the target amount (not allowance delta)', async () => {
    const harness = factory();
    const buildCtx = makeTestBuildCtx(kind, harness);

    const token = '0x8888888888888888888888888888888888888888' as Address;
    const amount = 100n;
    const currentAllowance = 40n;

    setL2TokenRegistration(harness, buildCtx.l2NativeTokenVault, token, TEST_ASSET_ID);
    setErc20Allowance(
      harness,
      token,
      buildCtx.sender,
      buildCtx.l2NativeTokenVault,
      currentAllowance,
    );

    const params = {
      actions: [{ type: 'sendErc20' as const, token, to: buildCtx.sender, amount }],
    };

    const result = await ROUTES[kind].build(params, buildCtx as any);
    const approveStep = result.steps.find((s) => s.kind === 'approve');
    expect(approveStep).toBeDefined();

    const erc20Iface = new Interface(IERC20ABI);
    const approveArgs = erc20Iface.decodeFunctionData('approve', approveStep!.tx.data as Hex);
    expect(approveArgs[1]).toBe(amount);
  });
});
