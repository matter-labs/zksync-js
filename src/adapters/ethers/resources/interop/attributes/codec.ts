// src/adapters/ethers/resources/interop/attributes/codec.ts
import { Interface } from 'ethers';
import IERC7786AttributesAbi from '../../../../../core/internal/abis/IERC7786Attributes';
import type { DecodedAttribute } from '../../../../../core/types/flows/interop';
import type { Hex } from '../../../../../core/types/primitives';
import type { AttributesCodec } from '../../../../../core/resources/interop/attributes/types';

export type EthersAttributesAbiCodec = AttributesCodec;

export function createEthersAttributesAbiCodec(
  opts: { iface?: Interface } = {},
): EthersAttributesAbiCodec {
  const iface = opts.iface ?? new Interface(IERC7786AttributesAbi);

  const encode = (fn: string, args: readonly unknown[]): Hex =>
    iface.encodeFunctionData(fn, args) as Hex;

  const decode = (attr: Hex): DecodedAttribute => {
    const selector = (typeof attr === 'string' ? attr.slice(0, 10) : '0x') as Hex;

    try {
      const frag = iface.getFunction(selector);
      if (!frag) {
        return { selector, name: 'unknown', args: [attr] };
      }

      let signature: string | undefined;
      try {
        signature = frag.format();
      } catch {
        signature = undefined;
      }

      try {
        const decoded = iface.decodeFunctionData(frag, attr);
        return {
          selector,
          name: frag.name,
          signature,
          args: Array.from(decoded),
        };
      } catch {
        return {
          selector,
          name: frag.name,
          signature,
          args: [attr],
        };
      }
    } catch {
      return { selector, name: 'unknown', args: [attr] };
    }
  };

  return { encode, decode };
}
