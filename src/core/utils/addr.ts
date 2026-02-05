import type { Address, Hex } from '../types/primitives';
import { FORMAL_ETH_ADDRESS, ETH_ADDRESS, L2_BASE_TOKEN_ADDRESS } from '../constants';
import { isHash } from './hash';

export function isAddress(x: unknown): x is Address {
  return isHash(x, 42); // 40 hex chars + '0x' prefix
}

// Compares two addresses for equality, ignoring case
export function isAddressEq(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// Returns true if the address is any of the known ETH aliases
export function isETH(token: Address) {
  return (
    isAddressEq(token, FORMAL_ETH_ADDRESS) ||
    isAddressEq(token, L2_BASE_TOKEN_ADDRESS) ||
    isAddressEq(token, ETH_ADDRESS)
  );
}

// Compares two addresses for equality, ignoring case and '0x' prefix
export function normalizeAddrEq(a?: string, b?: string): boolean {
  if (!a || !b) return false;

  const normalize = (s: string) => {
    // Treat "0x" or "0X" as prefix
    const hasPrefix = s.slice(0, 2).toLowerCase() === '0x';
    const body = hasPrefix ? s.slice(2) : s;
    return `0x${body.toLowerCase()}`;
  };

  return normalize(a) === normalize(b);
}

// Hex comparison for bytes32/assetIds
export const hexEq = (a: Hex, b: Hex): boolean => a.toLowerCase() === b.toLowerCase();

// Normalize L1 token address (FORMAL_ETH_ADDRESS → ETH_ADDRESS)
export const normalizeL1Token = (token: Address): Address =>
  isAddressEq(token, FORMAL_ETH_ADDRESS) ? ETH_ADDRESS : token;
