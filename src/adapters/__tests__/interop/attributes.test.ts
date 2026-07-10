import { describe, expect, it } from 'bun:test';
import { Interface } from 'ethers';

import IERC7786AttributesABI from '../../../core/internal/abis/IERC7786Attributes';
import type { Hex } from '../../../core/types/primitives';
import {
  createEthersAttributesResource,
  getInteropAttributes as getEthersInteropAttributes,
} from '../../ethers/resources/interop/attributes/resource';
import {
  createViemAttributesResource,
  getInteropAttributes as getViemInteropAttributes,
} from '../../viem/resources/interop/attributes/resource';

const SALT = `0x${'42'.repeat(32)}` as Hex;
const iface = new Interface(IERC7786AttributesABI);

describe('interop bundle attributes', () => {
  for (const kind of ['ethers', 'viem'] as const) {
    it(`${kind} appends the supplied unique bundle salt`, () => {
      const attributes =
        kind === 'ethers' ? createEthersAttributesResource() : createViemAttributesResource();
      const ctx = { attributes } as never;
      const result =
        kind === 'ethers'
          ? getEthersInteropAttributes({ actions: [] }, ctx, SALT)
          : getViemInteropAttributes({ actions: [] }, ctx, SALT);

      expect(result.bundleAttributes).toHaveLength(2);
      const [decodedSalt] = iface.decodeFunctionData(
        'interopBundleSalt',
        result.bundleAttributes[1],
      );
      expect(decodedSalt).toBe(SALT);
    });
  }
});
