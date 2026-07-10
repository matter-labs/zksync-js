import { bytesToHex, randomBytes } from '@noble/hashes/utils';

import type { Hex } from '../../types/primitives';

export type RandomBytes = (length: number) => Uint8Array;

export function generateBundleSalt(random: RandomBytes = randomBytes): Hex {
  const bytes = random(32);
  if (bytes.length !== 32) {
    throw new Error(`Bundle salt generator returned ${bytes.length} bytes; expected 32.`);
  }
  return `0x${bytesToHex(bytes)}`;
}
