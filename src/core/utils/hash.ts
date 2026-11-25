import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { Hex } from '../types/primitives';

const RegExpHex = /^0x[0-9a-fA-F]*$/;

export const isHash = (x: unknown, length?: number): boolean => {
  if (!x || typeof x !== 'string') return false;
  return (length === undefined || x.length === length) && RegExpHex.test(x);
};

export const isHashArray = (x: unknown, length?: number): boolean => {
  if (!Array.isArray(x)) return false;
  return x.every((item) => isHash(item, length));
};

// Returns true if the string is a 0x-prefixed hex of length 66 (32 bytes + '0x')
export const isHash66 = (x: unknown): x is Hex => isHash(x, 66);
export const isHash66Array = (x: unknown): x is Hex[] => isHashArray(x, 66);

/** keccak256 over raw 0x-prefixed hex bytes, as lowercase 0x-prefixed hex. */
export function keccakHex(data: Hex): Hex {
  return `0x${bytesToHex(keccak_256(hexToBytes(data.slice(2))))}`;
}
