import { decodeFunctionData, encodeFunctionData, getAbiItem } from 'viem';
import type { Abi } from 'viem';
import IERC7786AttributesAbi from '../../../../../core/internal/abis/IERC7786Attributes';
import type { DecodedAttribute } from '../../../../../core/types/flows/interop';
import type { Hex } from '../../../../../core/types/primitives';
import type { AttributesCodec } from '../../../../../core/resources/interop/attributes/types';

export type ViemAttributesAbiCodec = AttributesCodec;

export function createViemAttributesAbiCodec(): ViemAttributesAbiCodec {
  const abi = IERC7786AttributesAbi as Abi;

  const encode = (fn: string, args: readonly unknown[]): Hex =>
    encodeFunctionData({
      abi,
      functionName: fn as any,
      args: args as readonly unknown[],
    }) as Hex;

  const decode = (attr: Hex): DecodedAttribute => {
    const selector = (typeof attr === 'string' ? attr.slice(0, 10) : '0x') as Hex;

    try {
      const decoded = decodeFunctionData({ abi, data: attr });
      const name = decoded.functionName;
      let signature: string | undefined;

      try {
        const item = getAbiItem({ abi, name }) as { name?: string; inputs?: Array<{ type?: string }> };
        if (item?.name) {
          const inputs = Array.isArray(item.inputs) ? item.inputs : [];
          const types = inputs.map((input) => input.type ?? '').join(',');
          signature = `${item.name}(${types})`;
        }
      } catch {
        signature = undefined;
      }

      const args = Array.isArray(decoded.args) ? Array.from(decoded.args) : [decoded.args];

      return { selector, name, signature, args };
    } catch {
      return { selector, name: 'unknown', args: [attr] };
    }
  };

  return { encode, decode };
}
