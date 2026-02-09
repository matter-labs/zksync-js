import { describe, it, expect } from 'bun:test';
import { Interface } from 'ethers';

import { routeIndirect } from '../../ethers/resources/interop/routes/indirect.ts';
import {
  createEthersHarness,
  makeInteropContext,
  setErc20Allowance,
  setL2TokenRegistration,
} from '../adapter-harness.ts';
import { parseSendBundleTx } from '../decode-helpers.ts';
import { createEthersAttributesResource } from '../../ethers/resources/interop/attributes/resource.ts';
import { interopCodec } from '../../ethers/resources/interop/address.ts';
import {
  InteropCenterABI,
  IInteropHandlerABI,
  IERC20ABI,
  L2NativeTokenVaultABI,
} from '../../../core/abi.ts';
import { createTokensResource } from '../../ethers/resources/tokens/index.ts';
import type { BuildCtx } from '../../ethers/resources/interop/context.ts';
import type { Hex, Address } from '../../../core/types/primitives.ts';

const route = routeIndirect();

const TEST_ASSET_ID = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as Hex;

function makeTestBuildCtx(
  harness: ReturnType<typeof createEthersHarness>,
  overrides: Partial<BuildCtx> = {},
): BuildCtx {
  const ctx = makeInteropContext(harness);
  const attributes = createEthersAttributesResource();
  const tokens = createTokensResource(harness.client);

  const interopCenterIface = new Interface(InteropCenterABI);
  const interopHandlerIface = new Interface(IInteropHandlerABI);

  const topics = {
    interopBundleSent: interopCenterIface.getEvent('InteropBundleSent')!.topicHash as Hex,
    bundleVerified: interopHandlerIface.getEvent('BundleVerified')!.topicHash as Hex,
    bundleExecuted: interopHandlerIface.getEvent('BundleExecuted')!.topicHash as Hex,
    bundleUnbundled: interopHandlerIface.getEvent('BundleUnbundled')!.topicHash as Hex,
  };

  return {
    client: harness.client,
    tokens,
    contracts: ctx.contracts as any,
    sender: ctx.sender,
    chainIdL2: ctx.chainId,
    chainId: ctx.chainId,
    bridgehub: ctx.bridgehub,
    dstChainId: ctx.dstChainId,
    interopCenter: ctx.interopCenter,
    interopHandler: ctx.interopHandler,
    l2MessageVerification: ctx.l2MessageVerification,
    l2AssetRouter: ctx.l2AssetRouter,
    l2NativeTokenVault: ctx.l2NativeTokenVault,
    baseTokens: ctx.baseTokens,
    ifaces: { interopCenter: interopCenterIface, interopHandler: interopHandlerIface },
    topics,
    attributes,
    ...overrides,
  };
}

describe('adapters/interop/routeIndirect', () => {
  it('preflight throws when no actions are provided', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness);

    const params = {
      dstChainId: buildCtx.dstChainId,
      actions: [],
    };

    let caught: unknown;
    try {
      await route.preflight?.(params, buildCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/at least one action/);
  });

  it('preflight throws when no ERC-20 and base tokens match (should use direct)', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness);

    const params = {
      dstChainId: buildCtx.dstChainId,
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
      await route.preflight?.(params, buildCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/ERC-20|direct/i);
  });

  it('builds a sendBundle step for sendNative with mismatched base tokens', async () => {
    const harness = createEthersHarness();

    // Set up mismatched base tokens to enable indirect route for sendNative
    const buildCtx = makeTestBuildCtx(harness, {
      baseTokens: {
        src: '0xaaaa000000000000000000000000000000000000' as Address,
        dst: '0xbbbb000000000000000000000000000000000000' as Address,
      },
    });

    // Mock the token resource methods
    const baseAssetId = '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' as Hex;
    buildCtx.tokens = {
      ...buildCtx.tokens,
      baseTokenAssetId: async () => baseAssetId,
    } as any;

    const recipient = '0x2222222222222222222222222222222222222222' as Address;
    const amount = 1_000_000n;

    const params = {
      dstChainId: buildCtx.dstChainId,
      actions: [{ type: 'sendNative' as const, to: recipient, amount }],
    };

    const result = await route.build(params, buildCtx);

    expect(result.steps.length).toBe(1);
    // totalActionValue includes the sendNative amount as it will be bridged
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
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness, {
      baseTokens: {
        src: '0xaaaa000000000000000000000000000000000000' as Address,
        dst: '0xbbbb000000000000000000000000000000000000' as Address,
      },
    });

    const params = {
      dstChainId: buildCtx.dstChainId,
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
      await route.preflight?.(params, buildCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/call\.value|base tokens/i);
  });

  it('preflight passes for sendNative with negative amount validation', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness, {
      baseTokens: {
        src: '0xaaaa000000000000000000000000000000000000' as Address,
        dst: '0xbbbb000000000000000000000000000000000000' as Address,
      },
    });

    const params = {
      dstChainId: buildCtx.dstChainId,
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
      await route.preflight?.(params, buildCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/amount must be >= 0/);
  });

  it('encodes destination chain ID correctly in the bundle', async () => {
    const harness = createEthersHarness();
    const dstChainId = 999n;

    const buildCtx = makeTestBuildCtx(harness, {
      dstChainId,
      baseTokens: {
        src: '0xaaaa000000000000000000000000000000000000' as Address,
        dst: '0xbbbb000000000000000000000000000000000000' as Address,
      },
    });

    buildCtx.tokens = {
      ...buildCtx.tokens,
      baseTokenAssetId: async () => TEST_ASSET_ID,
    } as any;

    const params = {
      dstChainId,
      actions: [
        {
          type: 'sendNative' as const,
          to: '0x1111111111111111111111111111111111111111' as Address,
          amount: 100n,
        },
      ],
    };

    const result = await route.build(params, buildCtx);
    const sendBundleStep = result.steps.find((s) => s.key === 'sendBundle');
    const decoded = parseSendBundleTx(sendBundleStep!.tx);

    const expectedDstChain = interopCodec.formatChain(dstChainId);
    expect(decoded.destinationChainId).toBe(expectedDstChain);
  });

  it('handles call action without value in indirect route', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness, {
      baseTokens: {
        src: '0xaaaa000000000000000000000000000000000000' as Address,
        dst: '0xbbbb000000000000000000000000000000000000' as Address,
      },
    });

    buildCtx.tokens = {
      ...buildCtx.tokens,
      baseTokenAssetId: async () => TEST_ASSET_ID,
    } as any;

    const target = '0x3333333333333333333333333333333333333333' as Address;
    const callData = '0xabcdef12' as Hex;

    const params = {
      dstChainId: buildCtx.dstChainId,
      actions: [
        {
          type: 'sendNative' as const,
          to: '0x1111111111111111111111111111111111111111' as Address,
          amount: 100n,
        },
        { type: 'call' as const, to: target, data: callData },
      ],
    };

    const result = await route.build(params, buildCtx);

    expect(result.steps.length).toBe(1);
    const decoded = parseSendBundleTx(result.steps[0].tx);
    expect(decoded.callStarters.length).toBe(2);

    // Second starter should be the call action
    const callStarter = decoded.callStarters[1];
    expect(callStarter.to).toBe(interopCodec.formatAddress(target));
    expect(callStarter.data).toBe(callData);
  });

  it('builds ensure-token and approve steps for ERC-20 actions', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness);

    const token = '0x7777777777777777777777777777777777777777' as Address;
    const amount = 100n;

    setL2TokenRegistration(harness, buildCtx.l2NativeTokenVault, token, TEST_ASSET_ID);
    setErc20Allowance(harness, token, buildCtx.sender, buildCtx.l2NativeTokenVault, 0n);

    const params = {
      dstChainId: buildCtx.dstChainId,
      actions: [{ type: 'sendErc20' as const, token, to: buildCtx.sender, amount }],
    };

    const result = await route.build(params, buildCtx);
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
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness);

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
      dstChainId: buildCtx.dstChainId,
      actions: [{ type: 'sendErc20' as const, token, to: buildCtx.sender, amount }],
    };

    const result = await route.build(params, buildCtx);
    const approveStep = result.steps.find((s) => s.kind === 'approve');
    expect(approveStep).toBeDefined();

    const erc20Iface = new Interface(IERC20ABI);
    const approveArgs = erc20Iface.decodeFunctionData('approve', approveStep!.tx.data as Hex);
    expect(approveArgs[1]).toBe(amount);
  });
});
