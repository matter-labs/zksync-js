// src/adapters/viem/resources/interop/attributes/resource.ts
import { encodeFunctionData } from 'viem';
import {
  createAttributesResource,
  type AttributesResource,
} from '../../../../../core/resources/interop/attributes/resource';
import IERC7786AttributesAbi from '../../../../../core/internal/abis/IERC7786Attributes';
import type { Hex } from '../../../../../core/types/primitives';
import type { InteropParams } from '../../../../../core/types/flows/interop';
import type { BuildCtx } from '../context';
import type { InteropAttributes } from '../../../../../core/resources/interop/plan';
import { assertNever } from '../../../../../core/utils';

export function getInteropAttributes(params: InteropParams, ctx: BuildCtx): InteropAttributes {
  const bundleAttributes: Hex[] = [];
  if (params.execution?.only) {
    bundleAttributes.push(ctx.attributes.bundle.executionAddress(params.execution.only));
  }
  if (params.unbundling?.by) {
    bundleAttributes.push(ctx.attributes.bundle.unbundlerAddress(params.unbundling.by));
  }
  bundleAttributes.push(ctx.attributes.bundle.useFixedFee(params.fee?.useFixed ?? false));

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

export function createViemAttributesResource(): AttributesResource {
  const encode = (fn: string, args: readonly unknown[]): Hex =>
    encodeFunctionData({
      abi: IERC7786AttributesAbi,
      functionName: fn as never,
      args: args as never,
    });

  return createAttributesResource({ encode });
}
