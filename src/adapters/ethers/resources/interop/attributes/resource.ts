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
import { InteropAttributes } from '../../../../../core/resources/interop/plan';
import { assertNever } from '../../../../../core/utils';

export function getInteropAttributes(params: InteropParams, ctx: BuildCtx): InteropAttributes {
  const bundleAttributes: Hex[] = [];
  if (params.execution?.only) {
    bundleAttributes.push(ctx.attributes.bundle.executionAddress(params.execution.only));
  }
  if (params.unbundling?.by) {
    bundleAttributes.push(ctx.attributes.bundle.unbundlerAddress(params.unbundling.by));
  }

  const callAttributes = params.actions.map((action) => {
    switch (action.type) {
      case 'sendNative': {
        const baseMatches = ctx.baseTokens.src.toLowerCase() === ctx.baseTokens.dst.toLowerCase();
        if (baseMatches) {
          return [ctx.attributes.call.interopCallValue(action.amount)];
        }
        return [ctx.attributes.call.indirectCall(action.amount)];
      }
      case 'call':
        if (action.value && action.value > 0n) {
          return [ctx.attributes.call.interopCallValue(action.value)];
        }
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
