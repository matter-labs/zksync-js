import { describe, expect, it } from 'bun:test';
import { Interface } from 'ethers';
import type { Address, Hex } from '../../../core/types/primitives';
import { IInteropCenterABI } from '../../../core/abi';
import IERC7786AttributesABI from '../../../core/internal/abis/IERC7786Attributes';
import { routeDirect as ethersRoute } from '../../ethers/resources/interop/routes/direct';
import { routeDirect as viemRoute } from '../../viem/resources/interop/routes/direct';
import { createEthersAttributesResource } from '../../ethers/resources/interop/attributes/resource';
import { createViemAttributesResource } from '../../viem/resources/interop/attributes/resource';
import { interopCodec as ethersCodec } from '../../ethers/resources/interop/address';
import { interopCodec as viemCodec } from '../../viem/resources/interop/address';
import {
  createAdapterHarness,
  makeInteropContext,
  setInteropProtocolFee,
} from '../adapter-harness';
import { parseSendBundleTx } from '../decode-helpers';

const TARGET = '0x2222222222222222222222222222222222222222' as Address;
const SALT = `0x${'44'.repeat(32)}` as Hex;
const FLOW_ID = `0x${'55'.repeat(32)}` as Hex;
const DEADLINE = 1_900_000_000n;
const atomic = { flowId: FLOW_ID, deadline: DEADLINE, lowNullifierIndex: 7n };
const attributeInterface = new Interface(IERC7786AttributesABI);

function buildContext(kind: 'ethers' | 'viem', harness: any) {
  const base = makeInteropContext(harness);
  setInteropProtocolFee(harness, base.interopCenter, 0n);
  const attributes =
    kind === 'ethers' ? createEthersAttributesResource() : createViemAttributesResource();
  if (kind === 'ethers') {
    return {
      ...base,
      chainIdL2: base.chainId,
      dstProvider: harness.l2,
      attributes,
      ifaces: { interopCenter: new Interface(IInteropCenterABI) },
    };
  }
  return { ...base, chainIdL2: base.chainId, dstPublicClient: harness.l2, attributes };
}

describe('atomic interop direct route adapter parity', () => {
  for (const kind of ['ethers', 'viem'] as const) {
    it(`${kind} encodes a zero-value recoverable call with atomic metadata`, async () => {
      const harness = createAdapterHarness(kind);
      const context = buildContext(kind, harness);
      const route = kind === 'ethers' ? ethersRoute() : viemRoute();
      const params = {
        actions: [
          {
            type: 'call' as const,
            to: TARGET,
            data: '0x12345678' as Hex,
            recovery: { protocol: 'IAtomicRecoverable' as const },
          },
        ],
        deadline: DEADLINE,
      };

      await route.preflight(params, context as never);
      const result = await route.build(params, context as never, { bundleSalt: SALT, atomic });
      const decoded = parseSendBundleTx(result.steps[0].tx);
      const codec = kind === 'ethers' ? ethersCodec : viemCodec;

      expect(decoded.value).toBe(0n);
      expect(decoded.destinationChainId).toBe(codec.formatChain(context.dstChainId));
      expect(decoded.callStarters).toEqual([
        { to: codec.formatAddress(TARGET), data: '0x12345678', callAttributes: [] },
      ]);
      expect(decoded.bundleAttributes).toHaveLength(3);
      expect(
        attributeInterface.decodeFunctionData('interopBundleSalt', decoded.bundleAttributes[1])[0],
      ).toBe(SALT);
      expect(
        attributeInterface.decodeFunctionData('atomicBundle', decoded.bundleAttributes[2]),
      ).toEqual([FLOW_ID, DEADLINE, 7n]);
    });
  }

  it('ethers and viem produce byte-identical sendBundle calldata', async () => {
    const results: string[] = [];
    for (const kind of ['ethers', 'viem'] as const) {
      const harness = createAdapterHarness(kind);
      const context = buildContext(kind, harness);
      const route = kind === 'ethers' ? ethersRoute() : viemRoute();
      const built = await route.build(
        {
          actions: [
            {
              type: 'call',
              to: TARGET,
              data: '0xabcd',
              recovery: { protocol: 'IAtomicRecoverable' },
            },
          ],
          deadline: DEADLINE,
        },
        context as never,
        { bundleSalt: SALT, atomic },
      );
      results.push(built.steps[0].tx.data!);
    }
    expect(results[0]).toBe(results[1]);
  });
});
