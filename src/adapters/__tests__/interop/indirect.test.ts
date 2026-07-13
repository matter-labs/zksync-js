import { describe, expect, it } from 'bun:test';
import { Interface } from 'ethers';
import type { Address, Hex } from '../../../core/types/primitives';
import { IERC20ABI, IInteropCenterABI, L2NativeTokenVaultABI } from '../../../core/abi';
import { routeIndirect as ethersRoute } from '../../ethers/resources/interop/routes/indirect';
import { routeIndirect as viemRoute } from '../../viem/resources/interop/routes/indirect';
import { createEthersAttributesResource } from '../../ethers/resources/interop/attributes/resource';
import { createViemAttributesResource } from '../../viem/resources/interop/attributes/resource';
import {
  createAdapterHarness,
  makeInteropContext,
  setErc20Allowance,
  setInteropProtocolFee,
  setL2TokenRegistration,
} from '../adapter-harness';
import { parseSendBundleTx } from '../decode-helpers';

const TOKEN = '0x7777777777777777777777777777777777777777' as Address;
const RECIPIENT = '0x8888888888888888888888888888888888888888' as Address;
const ASSET_ID = `0x${'12'.repeat(32)}` as Hex;
const SALT = `0x${'44'.repeat(32)}` as Hex;
const FLOW_ID = `0x${'55'.repeat(32)}` as Hex;
const DEADLINE = 1_900_000_000n;
const atomic = { flowId: FLOW_ID, deadline: DEADLINE, lowNullifierIndex: 7n };

function buildContext(kind: 'ethers' | 'viem', harness: any) {
  const base = makeInteropContext(harness);
  setInteropProtocolFee(harness, base.interopCenter, 0n);
  setL2TokenRegistration(harness, base.l2NativeTokenVault, TOKEN, ASSET_ID);
  setErc20Allowance(harness, TOKEN, base.sender, base.l2NativeTokenVault, 0n);
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

describe('atomic interop ERC-20 route adapter parity', () => {
  for (const kind of ['ethers', 'viem'] as const) {
    it(`${kind} plans registration, exact approval, and an atomic asset-router bundle`, async () => {
      const harness = createAdapterHarness(kind);
      const context = buildContext(kind, harness);
      const route = kind === 'ethers' ? ethersRoute() : viemRoute();
      const params = {
        actions: [{ type: 'sendErc20' as const, token: TOKEN, to: RECIPIENT, amount: 25n }],
        deadline: DEADLINE,
      };

      await route.preflight(params, context as never);
      const result = await route.build(params, context as never, { bundleSalt: SALT, atomic });
      expect(result.steps.map((step) => step.kind)).toEqual([
        'interop.ntv.ensure-token',
        'approve',
        'interop.center',
      ]);

      const ntv = new Interface(L2NativeTokenVaultABI);
      expect(ntv.decodeFunctionData('ensureTokenIsRegistered', result.steps[0].tx.data!)[0]).toBe(
        TOKEN,
      );
      const erc20 = new Interface(IERC20ABI);
      expect(erc20.decodeFunctionData('approve', result.steps[1].tx.data!)).toEqual([
        context.l2NativeTokenVault,
        25n,
      ]);

      const decoded = parseSendBundleTx(result.steps[2].tx);
      expect(decoded.value).toBe(0n);
      expect(decoded.callStarters).toHaveLength(1);
      expect(decoded.callStarters[0].to).toBe(
        (kind === 'ethers'
          ? (await import('../../ethers/resources/interop/address')).interopCodec
          : (await import('../../viem/resources/interop/address')).interopCodec
        ).formatAddress(context.l2AssetRouter),
      );
      expect(decoded.bundleAttributes).toHaveLength(3);
    });
  }

  it('ethers and viem produce byte-identical ERC-20 sendBundle calldata', async () => {
    const calldata: string[] = [];
    for (const kind of ['ethers', 'viem'] as const) {
      const harness = createAdapterHarness(kind);
      const context = buildContext(kind, harness);
      const route = kind === 'ethers' ? ethersRoute() : viemRoute();
      const result = await route.build(
        {
          actions: [{ type: 'sendErc20', token: TOKEN, to: RECIPIENT, amount: 25n }],
          deadline: DEADLINE,
        },
        context as never,
        { bundleSalt: SALT, atomic },
      );
      calldata.push(result.steps.at(-1)!.tx.data!);
    }
    expect(calldata[0]).toBe(calldata[1]);
  });
});
