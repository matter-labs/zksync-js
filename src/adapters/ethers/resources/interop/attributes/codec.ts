// src/adapters/ethers/resources/interop/attributes/codec.ts
import { Interface } from 'ethers';
import IERC7786AttributesAbi from '../../../../../core/internal/abis/IERC7786Attributes';
import type { Hex } from '../../../../../core/types/primitives';
import type { AttributesCodec } from '../../../../../core/resources/interop/attributes/types';

export type EthersAttributesAbiCodec = AttributesCodec;

export function createEthersAttributesAbiCodec(
  opts: { iface?: Interface } = {},
): EthersAttributesAbiCodec {
  const iface = opts.iface ?? new Interface(IERC7786AttributesAbi);

  const encode = (fn: string, args: readonly unknown[]): Hex =>
    iface.encodeFunctionData(fn, args) as Hex;

  return { encode };
}
