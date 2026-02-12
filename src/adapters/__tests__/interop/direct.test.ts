import { describe, it, expect } from 'bun:test';
import { Interface } from 'ethers';

import { routeDirect } from '../../ethers/resources/interop/routes/direct.ts';
import { createEthersHarness, makeInteropContext } from '../adapter-harness.ts';
import { parseSendBundleTx } from '../decode-helpers.ts';
import { createEthersAttributesResource } from '../../ethers/resources/interop/attributes/resource.ts';
import { interopCodec } from '../../ethers/resources/interop/address.ts';
import { InteropCenterABI, IInteropHandlerABI } from '../../../core/abi.ts';
import type { BuildCtx } from '../../ethers/resources/interop/context.ts';
import type { Hex, Address } from '../../../core/types/primitives.ts';

const route = routeDirect();

function makeTestBuildCtx(
  harness: ReturnType<typeof createEthersHarness>,
  overrides: Partial<BuildCtx> = {},
): BuildCtx {
  const ctx = makeInteropContext(harness);
  const attributes = createEthersAttributesResource();

  const interopCenterIface = new Interface(InteropCenterABI);
  const interopHandlerIface = new Interface(IInteropHandlerABI);

  return {
    client: harness.client,
    tokens: {} as any,
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

describe('adapters/interop/routeDirect', () => {
  it('builds a sendBundle step for a single sendNative action', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness);

    const recipient = '0x2222222222222222222222222222222222222222' as Address;
    const amount = 1_000_000n;

    const params = {
      actions: [{ type: 'sendNative' as const, to: recipient, amount }],
    };

    const result = await route.build(params, buildCtx);

    expect(result.steps.length).toBe(1);
    expect(result.approvals.length).toBe(0);
    expect(result.quoteExtras.totalActionValue).toBe(amount);
    expect(result.quoteExtras.bridgedTokenTotal).toBe(0n);

    const step = result.steps[0];
    expect(step.key).toBe('sendBundle');
    expect(step.kind).toBe('interop.center');

    const decoded = parseSendBundleTx(step.tx);
    expect(decoded.to).toBe(buildCtx.interopCenter.toLowerCase());
    expect(decoded.value).toBe(amount);
    expect(decoded.callStarters.length).toBe(1);

    const starter = decoded.callStarters[0];
    expect(starter.to).toBe(interopCodec.formatAddress(recipient));
    expect(starter.data).toBe('0x');
  });

  it('builds a sendBundle step for multiple sendNative actions', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness);

    const recipient1 = '0x1111111111111111111111111111111111111111' as Address;
    const recipient2 = '0x2222222222222222222222222222222222222222' as Address;
    const amount1 = 500_000n;
    const amount2 = 300_000n;

    const params = {
      actions: [
        { type: 'sendNative' as const, to: recipient1, amount: amount1 },
        { type: 'sendNative' as const, to: recipient2, amount: amount2 },
      ],
    };

    const result = await route.build(params, buildCtx);

    expect(result.steps.length).toBe(1);
    expect(result.quoteExtras.totalActionValue).toBe(amount1 + amount2);

    const decoded = parseSendBundleTx(result.steps[0].tx);
    expect(decoded.value).toBe(amount1 + amount2);
    expect(decoded.callStarters.length).toBe(2);

    expect(decoded.callStarters[0].to).toBe(interopCodec.formatAddress(recipient1));
    expect(decoded.callStarters[1].to).toBe(interopCodec.formatAddress(recipient2));
  });

  it('builds a sendBundle step for a call action with value', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness);

    const target = '0x3333333333333333333333333333333333333333' as Address;
    const callData = '0xabcdef12' as Hex;
    const value = 100_000n;

    const params = {
      actions: [{ type: 'call' as const, to: target, data: callData, value }],
    };

    const result = await route.build(params, buildCtx);

    expect(result.steps.length).toBe(1);
    expect(result.quoteExtras.totalActionValue).toBe(value);

    const decoded = parseSendBundleTx(result.steps[0].tx);
    expect(decoded.value).toBe(value);
    expect(decoded.callStarters.length).toBe(1);

    const starter = decoded.callStarters[0];
    expect(starter.to).toBe(interopCodec.formatAddress(target));
    expect(starter.data).toBe(callData);
  });

  it('builds a sendBundle step for a call action without value', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness);

    const target = '0x4444444444444444444444444444444444444444' as Address;
    const callData = '0x12345678' as Hex;

    const params = {
      actions: [{ type: 'call' as const, to: target, data: callData }],
    };

    const result = await route.build(params, buildCtx);

    expect(result.steps.length).toBe(1);
    expect(result.quoteExtras.totalActionValue).toBe(0n);

    const decoded = parseSendBundleTx(result.steps[0].tx);
    expect(decoded.value).toBe(0n);

    const starter = decoded.callStarters[0];
    expect(starter.to).toBe(interopCodec.formatAddress(target));
    expect(starter.data).toBe(callData);
  });

  it('throws on sendErc20 action (unsupported in direct route)', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness);

    const params = {
      actions: [
        {
          type: 'sendErc20' as const,
          token: '0x5555555555555555555555555555555555555555' as Address,
          to: '0x6666666666666666666666666666666666666666' as Address,
          amount: 100n,
        },
      ],
    };

    let caught: unknown;
    try {
      await route.build(params, buildCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });

  it('preflight throws when no actions are provided', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness);

    const params = {
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

  it('preflight throws when base tokens do not match', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness, {
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
    expect(String(caught)).toMatch(/matching base tokens/);
  });

  it('encodes destination chain ID correctly in the bundle', async () => {
    const harness = createEthersHarness();
    const buildCtx = makeTestBuildCtx(harness, { dstChainId: 999n });

    const params = {
      actions: [
        {
          type: 'sendNative' as const,
          to: '0x1111111111111111111111111111111111111111' as Address,
          amount: 100n,
        },
      ],
    };

    const result = await route.build(params, buildCtx);
    const decoded = parseSendBundleTx(result.steps[0].tx);

    const expectedDstChain = interopCodec.formatChain(999n);
    expect(decoded.destinationChainId).toBe(expectedDstChain);
  });
});
