// src/adapters/ethers/resources/tokens/tokens.ts

import { AbiCoder, ethers } from 'ethers';
import type { EthersClient } from '../../client';
import type { Address, Hex } from '../../../../core/types/primitives';
import type { TokensResource, ResolvedToken, TokenRef, TokenKind } from './types';
import { createErrorHandlers } from '../../errors/error-ops';
import { isAddressEq } from '../../../../core/utils/addr';
import {
    ETH_ADDRESS,
    FORMAL_ETH_ADDRESS,
    L2_BASE_TOKEN_ADDRESS,
    L2_NATIVE_TOKEN_VAULT_ADDRESS,
} from '../../../../core/constants';
import { createNTVCodec } from '../../../../core/codec/ntv';

// Error handling for tokens resource
const { wrapAs } = createErrorHandlers('tokens');

// Create NTV codec with ethers dependencies
const ntvCodec = createNTVCodec({
    encode: (types, values) => new AbiCoder().encode(types, values) as Hex,
    keccak256: (data: Hex) => ethers.keccak256(data) as Hex,
});

/**
 * Creates a tokens resource for managing token identity, L1/L2 mappings,
 * and bridge assetId primitives.
 *
 * @param client - EthersClient instance
 * @returns TokensResource instance
 */
export function createTokensResource(client: EthersClient): TokensResource {
    // Promise-based caching for immutable chain values
    let l2NtvL1ChainIdPromise: Promise<bigint> | null = null;
    let baseTokenAssetIdPromise: Promise<Hex> | null = null;
    let wethL1Promise: Promise<Address> | null = null;
    let wethL2Promise: Promise<Address> | null = null;

    /**
     * Gets the L1 chain ID from L2 NTV (cached)
     */
    async function getL2NtvL1ChainId(): Promise<bigint> {
        if (!l2NtvL1ChainIdPromise) {
            l2NtvL1ChainIdPromise = wrapAs('INTERNAL', 'getL2NtvL1ChainId', async () => {
                const { l2NativeTokenVault } = await client.contracts();
                const chainId = (await l2NativeTokenVault.L1_CHAIN_ID()) as bigint;
                return chainId;
            });
        }
        return l2NtvL1ChainIdPromise;
    }

    /**
     * Gets the base token assetId from L2 NTV (cached)
     */
    async function getBaseTokenAssetId(): Promise<Hex> {
        if (!baseTokenAssetIdPromise) {
            baseTokenAssetIdPromise = wrapAs('INTERNAL', 'baseTokenAssetId', async () => {
                const { l2NativeTokenVault } = await client.contracts();
                const assetId = (await l2NativeTokenVault.BASE_TOKEN_ASSET_ID()) as string;
                return assetId as Hex;
            });
        }
        return baseTokenAssetIdPromise;
    }

    /**
     * Gets WETH address on L1 (cached)
     */
    async function getWethL1(): Promise<Address> {
        if (!wethL1Promise) {
            wethL1Promise = wrapAs('INTERNAL', 'wethL1', async () => {
                const { l1NativeTokenVault } = await client.contracts();
                const weth = (await l1NativeTokenVault.WETH_TOKEN()) as string;
                return weth as Address;
            });
        }
        return wethL1Promise;
    }

    /**
     * Gets WETH address on L2 (cached)
     */
    async function getWethL2(): Promise<Address> {
        if (!wethL2Promise) {
            wethL2Promise = wrapAs('INTERNAL', 'wethL2', async () => {
                const { l2NativeTokenVault } = await client.contracts();
                const weth = (await l2NativeTokenVault.WETH_TOKEN()) as string;
                return weth as Address;
            });
        }
        return wethL2Promise;
    }

    // -------------------------
    // Public API Implementation
    // -------------------------

    async function toL2Address(l1Token: Address): Promise<Address> {
        return wrapAs('INTERNAL', 'toL2Address', async () => {
            // Normalize FORMAL_ETH_ADDRESS → ETH_ADDRESS
            const normalized = isAddressEq(l1Token, FORMAL_ETH_ADDRESS) ? ETH_ADDRESS : l1Token;

            // If token is the chain's base token on L1, return L2_BASE_TOKEN_ADDRESS
            const { chainId } = await client.l2.getNetwork();
            const baseToken = await client.baseToken(BigInt(chainId));
            if (isAddressEq(normalized, baseToken)) {
                return L2_BASE_TOKEN_ADDRESS;
            }

            // Query L2 NTV for L2 token address
            const { l2NativeTokenVault } = await client.contracts();
            const l2Token = (await l2NativeTokenVault.l2TokenAddress(normalized)) as string;
            return l2Token as Address;
        });
    }

    async function toL1Address(l2Token: Address): Promise<Address> {
        return wrapAs('INTERNAL', 'toL1Address', async () => {
            // If L2 token is ETH sentinel, return canonical ETH_ADDRESS
            if (isAddressEq(l2Token, ETH_ADDRESS)) {
                return ETH_ADDRESS;
            }

            // Query L2 AssetRouter for L1 token address
            const { l2AssetRouter } = await client.contracts();
            const l1Token = (await l2AssetRouter.l1TokenAddress(l2Token)) as string;
            return l1Token as Address;
        });
    }

    async function assetIdOfL1(l1Token: Address): Promise<Hex> {
        return wrapAs('INTERNAL', 'assetIdOfL1', async () => {
            // Normalize FORMAL_ETH_ADDRESS → ETH_ADDRESS
            const normalized = isAddressEq(l1Token, FORMAL_ETH_ADDRESS) ? ETH_ADDRESS : l1Token;

            // Query L1 NTV for assetId
            const { l1NativeTokenVault } = await client.contracts();
            const assetId = (await l1NativeTokenVault.assetId(normalized)) as string;
            return assetId as Hex;
        });
    }

    async function assetIdOfL2(l2Token: Address): Promise<Hex> {
        return wrapAs('INTERNAL', 'assetIdOfL2', async () => {
            // Query L2 NTV for assetId
            const { l2NativeTokenVault } = await client.contracts();
            const assetId = (await l2NativeTokenVault.assetId(l2Token)) as string;
            return assetId as Hex;
        });
    }

    async function l2TokenFromAssetId(assetId: Hex): Promise<Address> {
        return wrapAs('INTERNAL', 'l2TokenFromAssetId', async () => {
            const { l2NativeTokenVault } = await client.contracts();
            const tokenAddr = (await l2NativeTokenVault.tokenAddress(assetId)) as string;
            return tokenAddr as Address;
        });
    }

    async function l1TokenFromAssetId(assetId: Hex): Promise<Address> {
        return wrapAs('INTERNAL', 'l1TokenFromAssetId', async () => {
            const { l1NativeTokenVault } = await client.contracts();
            const tokenAddr = (await l1NativeTokenVault.tokenAddress(assetId)) as string;
            return tokenAddr as Address;
        });
    }

    async function originChainId(assetId: Hex): Promise<bigint> {
        return wrapAs('INTERNAL', 'originChainId', async () => {
            // Use L2 NTV context for originChainId lookup
            const { l2NativeTokenVault } = await client.contracts();
            const chainId = (await l2NativeTokenVault.originChainId(assetId)) as bigint;
            return chainId;
        });
    }

    async function baseTokenAssetId(): Promise<Hex> {
        return getBaseTokenAssetId();
    }

    async function isChainEthBased(): Promise<boolean> {
        return wrapAs('INTERNAL', 'isChainEthBased', async () => {
            // Get base token assetId
            const baseAssetId = await getBaseTokenAssetId();

            // Compute ETH assetId using NTV codec
            const l1ChainId = await getL2NtvL1ChainId();
            const ethAssetId = ntvCodec.encodeAssetId(l1ChainId, L2_NATIVE_TOKEN_VAULT_ADDRESS, ETH_ADDRESS);

            // Compare
            return isAddressEq(baseAssetId as Address, ethAssetId as Address);
        });
    }

    async function wethL1(): Promise<Address> {
        return getWethL1();
    }

    async function wethL2(): Promise<Address> {
        return getWethL2();
    }

    async function predictL2BridgedAddress(args: {
        originChainId: bigint;
        l1Token: Address;
    }): Promise<Address> {
        return wrapAs('INTERNAL', 'predictL2BridgedAddress', async () => {
            const { l2NativeTokenVault } = await client.contracts();
            const predicted = (await l2NativeTokenVault.calculateCreate2TokenAddress(
                args.originChainId,
                args.l1Token,
            )) as string;
            return predicted as Address;
        });
    }

    async function resolve(ref: Address | TokenRef, opts?: { chain?: 'l1' | 'l2' }): Promise<ResolvedToken> {
        return wrapAs('INTERNAL', 'resolve', async () => {
            // Parse input
            let chain: 'l1' | 'l2';
            let address: Address;

            if (typeof ref === 'string') {
                // Raw address - use opts.chain or default to 'l1'
                chain = opts?.chain ?? 'l1';
                address = ref;
            } else {
                // TokenRef object
                chain = ref.chain;
                address = ref.address;
            }

            // Resolve L1 and L2 addresses
            let l1: Address;
            let l2: Address;

            if (chain === 'l1') {
                l1 = address;
                l2 = await toL2Address(address);
            } else {
                l2 = address;
                l1 = await toL1Address(address);
            }

            // Compute assetId (prefer L1 for consistency)
            const assetId = await assetIdOfL1(l1);

            // Get origin chain ID
            const originChainIdVal = await originChainId(assetId);

            // Get chain facts (parallel)
            const [baseAssetId, wethL1Addr, wethL2Addr, ethBased] = await Promise.all([
                baseTokenAssetId(),
                wethL1(),
                wethL2(),
                isChainEthBased(),
            ]);

            // Determine token kind
            let kind: TokenKind;
            if (isAddressEq(l1, ETH_ADDRESS) || isAddressEq(l1, FORMAL_ETH_ADDRESS)) {
                kind = 'eth';
            } else if (isAddressEq(assetId as Address, baseAssetId as Address)) {
                kind = 'base';
            } else {
                kind = 'erc20';
            }

            return {
                kind,
                l1,
                l2,
                assetId,
                originChainId: originChainIdVal,
                isChainEthBased: ethBased,
                baseTokenAssetId: baseAssetId,
                wethL1: wethL1Addr,
                wethL2: wethL2Addr,
            };
        });
    }

    return {
        resolve,
        toL2Address,
        toL1Address,
        assetIdOfL1,
        assetIdOfL2,
        l2TokenFromAssetId,
        l1TokenFromAssetId,
        originChainId,
        baseTokenAssetId,
        isChainEthBased,
        wethL1,
        wethL2,
        predictL2BridgedAddress,
    };
}
