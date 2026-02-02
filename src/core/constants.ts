// core/constants.ts

import type { Address, Hex } from './types/primitives';

import { keccak_256 } from '@noble/hashes/sha3';
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils';

/** Keccak-256 of a string, returned as lowercase 0x-prefixed hex. */
export const k256hex = (s: string): Hex =>
  `0x${bytesToHex(keccak_256(utf8ToBytes(s)))}`.toLowerCase() as Hex;

// -----------------------------------------------------------------------------
// Addresses (system / core)
// -----------------------------------------------------------------------------

/** The formal zero address used to represent ETH on L1. */
export const FORMAL_ETH_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** Some contracts disallow the zero address; use 0x…01 as a stand-in when needed. */
export const ETH_ADDRESS: Address = '0x0000000000000000000000000000000000000001';

/** L2 Asset Router contract address. */
export const L2_ASSET_ROUTER_ADDRESS: Address = '0x0000000000000000000000000000000000010003';

/** L2 Native Token Vault contract address. */
export const L2_NATIVE_TOKEN_VAULT_ADDRESS: Address = '0x0000000000000000000000000000000000010004';

/** L1 Messenger contract address. */
export const L1_MESSENGER_ADDRESS: Address = '0x0000000000000000000000000000000000008008';

/** L2 Base Token System contract address. */
export const L2_BASE_TOKEN_ADDRESS: Address = '0x000000000000000000000000000000000000800A';

/** L1 token address (SOPH). */
export const L1_SOPH_TOKEN_ADDRESS: Address = '0xa9544a49d4aEa4c8E074431c89C79fA9592049d8';

// -----------------------------------------------------------------------------
// Event topics
// -----------------------------------------------------------------------------

// topic0 for L1MessageSent(address,bytes32,bytes)
export const TOPIC_L1_MESSAGE_SENT: Hex =
  '0x2632cc0d58b0cb1017b99cc0b6cc66ad86440cc0dd923bfdaa294f95ba1b0201';

/** New-format L1MessageSent(topic) signature: L1MessageSent(uint256,bytes32,bytes) */
export const TOPIC_L1_MESSAGE_SENT_NEW: Hex = k256hex('L1MessageSent(uint256,bytes32,bytes)');

/** Legacy-format L1MessageSent(topic) signature: L1MessageSent(address,bytes32,bytes) */
export const TOPIC_L1_MESSAGE_SENT_LEG: Hex = k256hex('L1MessageSent(address,bytes32,bytes)');

/** Optional canonical markers. */
export const TOPIC_CANONICAL_ASSIGNED: Hex =
  '0x779f441679936c5441b671969f37400b8c3ed0071cb47444431bf985754560df';

/** Optional canonical success marker. */
export const TOPIC_CANONICAL_SUCCESS: Hex =
  '0xe4def01b981193a97a9e81230d7b9f31812ceaf23f864a828a82c687911cb2df';

// -----------------------------------------------------------------------------
// L1->L2 ZKsync Fee Model
// Derived from: https://github.com/matter-labs/era-contracts/blob/main/docs/l2_system_contracts/zksync_fee_model.md
// TODO: Consider adding zksyn-contracts dep and importing these values directly.
// -----------------------------------------------------------------------------

// Buffer percentage added to gas estimates
export const BUFFER = 20n; // 20%
// Base tx slot overhead for L2 execution
export const TX_OVERHEAD_GAS = 10_000n;
// Per-byte bootloader memory overhead for stored tx data
export const TX_MEMORY_OVERHEAD_GAS = 10n;
// Approximate pubdata footprint (bytes) for a direct ETH deposit (state + logs)
export const DEFAULT_PUBDATA_BYTES = 155n;
// Approximate ABI-encoded size (bytes) of a deposit tx
export const DEFAULT_ABI_BYTES = 400n;
// Approximate safe L1 gas limit for bridge deposits
export const SAFE_L1_BRIDGE_GAS = 700_000n;

/**
 * Numerator used in scaling the gas limit to help ensure acceptance of L1->L2 txs.
 * Used with {@link L1_FEE_ESTIMATION_COEF_DENOMINATOR}.
 */
export const L1_FEE_ESTIMATION_COEF_NUMERATOR = 12;

/**
 * Denominator used in scaling the gas limit to help ensure acceptance of L1->L2 txs.
 * Used with {@link L1_FEE_ESTIMATION_COEF_NUMERATOR}.
 */
export const L1_FEE_ESTIMATION_COEF_DENOMINATOR = 10;
