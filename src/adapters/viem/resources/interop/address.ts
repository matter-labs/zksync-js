// Viem adapter: ERC-7930 interoperable address encoding
import { concat, getAddress, hexToBytes, toHex } from 'viem';
import type { Address, Hex } from '../../../../core/types/primitives';

function assertUint8(value: number, context: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${context} length must fit within uint8.`);
  }
}

function toMinimalBigEndianBytes(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new Error('Chain ID must be non-negative.');
  }
  if (value === 0n) {
    return new Uint8Array([0]);
  }
  // Convert to hex without leading zeros, then to bytes
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return hexToBytes(`0x${hex}`);
}

const PREFIX_EVM_CHAIN = hexToBytes('0x00010000'); // version(0x0001) + chainType(eip-155 → 0x0000)
const PREFIX_EVM_ADDRESS = hexToBytes('0x000100000014'); // version + chainType + zero chainRef len + addr len (20)

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

  return toHex(payload);
}

/**
 * Formats an ERC-7930 interoperable address (version 1) that describes an EVM address
 * without a chain reference. Mirrors InteroperableAddress.formatEvmV1(address).
 */
export function formatInteropEvmAddress(address: Address): Hex {
  const normalized = getAddress(address);
  const addrBytes = hexToBytes(normalized);

  if (addrBytes.length !== 20) {
    throw new Error('Interop address encoding requires a 20-byte EVM address.');
  }

  const payload = concat([PREFIX_EVM_ADDRESS, addrBytes]);
  return toHex(payload);
}
