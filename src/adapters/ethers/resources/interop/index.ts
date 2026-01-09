// src/adapters/ethers/resources/interop/index.ts
import type { EthersClient } from '../../client';
import { createEthersAttributesResource } from './attributes';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';

export interface InteropResource {
  attributes: AttributesResource;
}

export function createInteropResource(
  _client: EthersClient,
  deps: { attributes?: AttributesResource } = {},
): InteropResource {
  return {
    attributes: deps.attributes ?? createEthersAttributesResource(),
  };
}
