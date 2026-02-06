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

export function extractBundleAttributes(params: InteropParams, ctx: BuildCtx): Hex[] {
  const bundleAttributes: Hex[] = [];
  if (params.execution?.only) {
    bundleAttributes.push(ctx.attributes.bundle.executionAddress(params.execution.only));
  }
  if (params.unbundling?.by) {
    bundleAttributes.push(ctx.attributes.bundle.unbundlerAddress(params.unbundling.by));
  }
  return bundleAttributes;
}

export function createEthersAttributesResource(
  opts: { iface?: Interface } = {},
): AttributesResource {
  const iface = opts.iface ?? new Interface(IERC7786AttributesAbi);

  const encode = (fn: string, args: readonly unknown[]): Hex =>
    iface.encodeFunctionData(fn, args) as Hex;

  return createAttributesResource({ encode });
}
