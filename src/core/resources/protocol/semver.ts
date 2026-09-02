// src/core/resources/protocol/semver.ts
//
// Packing/unpacking of the protocol version, mirroring
// `l1-contracts/contracts/common/libraries/SemVer.sol`.

import type { ProtocolVersion } from '../../types/primitives';

/** Bit offset of the `minor` component inside a packed protocol version. */
export const SEMVER_MINOR_OFFSET = 32n;

/** Bit offset of the `major` component inside a packed protocol version. */
export const SEMVER_MAJOR_OFFSET = 64n;

const U32_MASK = 0xffffffffn;

/**
 * Unpacks a `uint256`/`uint96` packed protocol version into `[major, minor, patch]`.
 *
 * This is the layout returned by `ChainTypeManager.getProtocolVersion(chainId)`, which — unlike
 * `getSemverProtocolVersion()` — reports the version of a *specific chain* rather than the latest
 * version the CTM knows about. During a rolling ecosystem upgrade the two disagree, so anything
 * gating behaviour on a chain's capabilities must use the per-chain value.
 */
export function unpackSemver(packed: bigint): ProtocolVersion {
  const patch = Number(packed & U32_MASK);
  const minor = Number((packed >> SEMVER_MINOR_OFFSET) & U32_MASK);
  const major = Number((packed >> SEMVER_MAJOR_OFFSET) & U32_MASK);
  return [major, minor, patch];
}

/** Packs `[major, minor, patch]` back into a single integer. Inverse of {@link unpackSemver}. */
export function packSemver(version: ProtocolVersion): bigint {
  const [major, minor, patch] = version;
  return (
    (BigInt(major) << SEMVER_MAJOR_OFFSET) | (BigInt(minor) << SEMVER_MINOR_OFFSET) | BigInt(patch)
  );
}

/** Formats a protocol version for messages, e.g. `0.32.0`. */
export function formatProtocolVersion(version: ProtocolVersion): string {
  return version.join('.');
}
