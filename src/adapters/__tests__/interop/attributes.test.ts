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
          ? getEthersInteropAttributes({ actions: [], deadline: 10n }, ctx, SALT)
          : getViemInteropAttributes({ actions: [], deadline: 10n }, ctx, SALT);

      expect(result.bundleAttributes).toHaveLength(2);
      const [decodedSalt] = iface.decodeFunctionData(
        'interopBundleSalt',
        result.bundleAttributes[1],
      );
      expect(decodedSalt).toBe(SALT);
    });

    it(`${kind} appends atomic metadata out-of-band from the bundle hash`, () => {
      const attributes =
        kind === 'ethers' ? createEthersAttributesResource() : createViemAttributesResource();
      const ctx = { attributes } as never;
      const atomic = {
        flowId: `0x${'24'.repeat(32)}` as Hex,
        deadline: 100n,
        lowNullifierIndex: 3n,
      };
      const result =
        kind === 'ethers'
          ? getEthersInteropAttributes({ actions: [], deadline: 100n }, ctx, SALT, atomic)
          : getViemInteropAttributes({ actions: [], deadline: 100n }, ctx, SALT, atomic);
      expect(result.bundleAttributes).toHaveLength(3);
      expect(iface.decodeFunctionData('atomicBundle', result.bundleAttributes[2])).toEqual([
        atomic.flowId,
        100n,
        3n,
      ]);
    });
  }
});
