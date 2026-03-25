// Viem adapter: ERC-7930 interoperable address encoding
import { concat, getAddress, toBytes, toHex } from 'viem';
import type { Address, Hex } from '../../../../core/types/primitives';

const PREFIX_EVM_CHAIN = toBytes('0x00010000'); // version(0x0001) + chainType(eip-155 → 0x0000)
const PREFIX_EVM_ADDRESS = toBytes('0x000100000014'); // version + chainType + zero chainRef len + addr len (20)

/**
 * Formats an ERC-7930 interoperable address (version 1) that describes an EVM chain
 * without specifying a destination address. Mirrors InteroperableAddress.formatEvmV1(chainId).
 */
export function formatInteropEvmChain(chainId: bigint): Hex {
  const chainRef = toBytes(toHex(chainId));
  const chainRefLength = toBytes(toHex(chainRef.length, { size: 1 }));

  const payload = concat([PREFIX_EVM_CHAIN, chainRefLength, chainRef, new Uint8Array([0])]);
  return toHex(payload);
}

/**
 * Formats an ERC-7930 interoperable address (version 1) that describes an EVM address
 * without a chain reference. Mirrors InteroperableAddress.formatEvmV1(address).
 */
export function formatInteropEvmAddress(address: Address): Hex {
  const normalized = getAddress(address);
  const addrBytes = toBytes(normalized);
  const payload = concat([PREFIX_EVM_ADDRESS, addrBytes]);
  return toHex(payload);
}

/**
 * Codec for interop address encoding used by route builders.
 */
export const interopCodec = {
  formatChain: formatInteropEvmChain,
  formatAddress: formatInteropEvmAddress,
};
