// src/adapters/ethers/resources/interop/attributes/resource.ts
import type { Interface } from 'ethers';
import {
  createAttributesResource,
  type AttributesResource,
} from '../../../../../core/resources/interop/attributes/resource';
import { createEthersAttributesAbiCodec } from './codec';

export function createEthersAttributesResource(
  opts: { iface?: Interface } = {},
): AttributesResource {
  const codec = createEthersAttributesAbiCodec({ iface: opts.iface });
  return createAttributesResource(codec);
}
