// Ethers adapter: ERC-7930 interoperable address encoding
import { concat, getAddress, getBytes, hexlify, toBeHex } from 'ethers';
import type { Address, Hex } from '../../../../core/types/primitives';

function assertUint8(value: number, context: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${context} length must fit within uint8.`);
  }
}

function toMinimalBigEndianBytes(value: bigint): Uint8Array {
  if (value < 0) {
    throw new Error('Chain ID must be non-negative.');
  }
  const hex = toBeHex(value);
  return getBytes(hex);
}

const PREFIX_EVM_CHAIN = getBytes('0x00010000'); // version(0x0001) + chainType(eip-155 → 0x0000)
const PREFIX_EVM_ADDRESS = getBytes('0x000100000014'); // version + chainType + zero chainRef len + addr len (20)

/**
 * Formats an ERC-7930 interoperable address (version 1) that describes an EVM chain
 * without specifying a destination address. Mirrors InteroperableAddress.formatEvmV1(chainId).
 */
export function formatInteropEvmChain(chainId: bigint): Hex {
  const chainRef = toMinimalBigEndianBytes(chainId);
  assertUint8(chainRef.length, 'Chain reference');

  const payload = concat([
    PREFIX_EVM_CHAIN,
    new Uint8Array([chainRef.length]),
    chainRef,
    new Uint8Array([0]),
  ]);

  return hexlify(payload) as Hex;
}

/**
 * Formats an ERC-7930 interoperable address (version 1) that describes an EVM address
 * without a chain reference. Mirrors InteroperableAddress.formatEvmV1(address).
 */
export function formatInteropEvmAddress(address: Address): Hex {
  const normalized = getAddress(address);
  const addrBytes = getBytes(normalized);

  if (addrBytes.length !== 20) {
    throw new Error('Interop address encoding requires a 20-byte EVM address.');
  }

  const payload = concat([PREFIX_EVM_ADDRESS, addrBytes]);
  return hexlify(payload) as Hex;
}

/**
 * Codec for interop address encoding used by route builders.
 */
export const interopCodec = {
  formatChain: formatInteropEvmChain,
  formatAddress: formatInteropEvmAddress,
};
