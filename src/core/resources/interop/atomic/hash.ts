// src/core/resources/interop/atomic/hash.ts
//
// Keccak over raw bytes, kept dependency-free (no viem/ethers) so core can hash already-encoded data.

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { Hex } from '../../../types/primitives';

/** `keccak256` of 0x-prefixed hex bytes, as lowercase 0x-prefixed hex. */
export function keccak256Hex(data: Hex): Hex {
  return `0x${bytesToHex(keccak_256(hexToBytes(data.slice(2))))}`;
}
