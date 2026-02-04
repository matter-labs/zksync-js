import type { Hex } from '../types/primitives.ts';

const RegExpHex = /^0x[0-9a-fA-F]*$/;

export const isHash = (x: unknown, length: number): boolean => {
    if (!x || typeof x !== 'string') return false;
    return x.length === length && RegExpHex.test(x);
}

// Returns true if the string is a 0x-prefixed hex of length 66 (32 bytes + '0x')
export const isHash66 = (x: unknown): x is Hex => isHash(x, 66);