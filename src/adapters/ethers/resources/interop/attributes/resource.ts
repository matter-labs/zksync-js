// src/adapters/ethers/resources/interop/attributes/resource.ts
import { Interface } from 'ethers';
import {
  createAttributesResource,
  type AttributesResource,
} from '../../../../../core/resources/interop/attributes/resource';
import IERC7786AttributesAbi from '../../../../../core/internal/abis/IERC7786Attributes';
import type { Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type {
  InteropAtomicSend,
  InteropAttributes,
} from '../../../../../core/resources/interop/plan';
import { assertNever } from '../../../../../core/utils';
import { generateBundleSalt } from '../../../../../core/internal/cross-chain/salt';
import { interopCodec } from '../address';

export function getInteropAttributes(
  params: InteropParams,
  ctx: BuildCtx,
  bundleSalt = generateBundleSalt(),
  atomic?: InteropAtomicSend,
): InteropAttributes {
  const bundleAttributes: Hex[] = [];
  if (params.execution?.only) {
    bundleAttributes.push(
      ctx.attributes.bundle.executionAddress(interopCodec.formatAddress(params.execution.only)),
    );
  }
  bundleAttributes.push(ctx.attributes.bundle.useFixedFee(params.fee?.useFixed ?? false));
  bundleAttributes.push(ctx.attributes.bundle.interopBundleSalt(bundleSalt));
  if (atomic) {
    bundleAttributes.push(
      ctx.attributes.bundle.atomicBundle(atomic.flowId, atomic.deadline, atomic.lowNullifierIndex),
    );
  }

  const callAttributes = params.actions.map((action) => {
    switch (action.type) {
      case 'call':
        return [];
      case 'sendErc20':
        return [ctx.attributes.call.indirectCall(0n)];
      default:
        assertNever(action);
    }
  });

  return { bundleAttributes, callAttributes };
}

export function createEthersAttributesResource(
  opts: { iface?: Interface } = {},
): AttributesResource {
  const iface = opts.iface ?? new Interface(IERC7786AttributesAbi);

  const encode = (fn: string, args: readonly unknown[]): Hex =>
    iface.encodeFunctionData(fn, args) as Hex;

  return createAttributesResource({ encode });
}
