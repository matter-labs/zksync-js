// core/codec/ntv.ts

import type { Address, Hex } from '../types/primitives';

/**
 * Dependencies injected by the adapter (ethers or viem)
 */
export interface NTVCodecDeps {
    /**
     * ABI encoder: (types, values) => encoded hex string
     * For ethers: AbiCoder.encode
     * For viem: encodeAbiParameters
     */
    encode(types: string[], values: unknown[]): Hex;

    /**
     * Keccak-256 hash function: (data) => hash as hex string
     * For ethers: ethers.keccak256
     * For viem: keccak256
     */
    keccak256(data: Hex): Hex;
}

/**
 * Factory to create NTV (Native Token Vault) codec utilities.
 * This keeps core adapter-agnostic while enabling code reuse.
 *
 * @param deps - Adapter-specific encode and keccak256 implementations
 * @returns Codec utilities for NTV assetId encoding
 *
 * @example
 * ```typescript
 * // Ethers adapter
 * import { AbiCoder, ethers } from 'ethers';
 * const codec = createNTVCodec({
 *   encode: (types, values) => new AbiCoder().encode(types, values),
 *   keccak256: ethers.keccak256
 * });
 *
 * // Viem adapter
 * import { encodeAbiParameters, keccak256 } from 'viem';
 * const codec = createNTVCodec({
 *   encode: (types, values) => encodeAbiParameters(
 *     types.map((t, i) => ({ type: t, name: `arg${i}` })),
 *     values
 *   ),
 *   keccak256
 * });
 * ```
 */
export function createNTVCodec(deps: NTVCodecDeps) {
    /**
     * Encodes an assetId for a token in the Native Token Vault.
     *
     * The assetId is computed as:
     * `keccak256(abi.encode(originChainId, nativeTokenVaultAddress, tokenAddress))`
     *
     * @param originChainId - Chain ID where the token originates
     * @param ntvAddress - Address of the Native Token Vault contract
     * @param tokenAddress - Address of the token
     * @returns The computed assetId as a bytes32 hex string
     */
    function encodeAssetId(originChainId: bigint, ntvAddress: Address, tokenAddress: Address): Hex {
        const encoded = deps.encode(['uint256', 'address', 'address'], [originChainId, ntvAddress, tokenAddress]);
        return deps.keccak256(encoded);
    }

    return {
        encodeAssetId,
    };
}
