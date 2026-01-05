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
// Ethers ABI coder instance
const abi = AbiCoder.defaultAbiCoder();
// Create NTV codec
const ntvCodec = createNTVCodec({
  encode: (types, values) => abi.encode(types, values) as Hex,
  keccak256: (data: Hex) => ethers.keccak256(data) as Hex,
});

// TODO: These helper functions could be moved to core/utils/addr.ts

// Helper: Case-insensitive hex comparison for bytes32/assetIds
const hexEq = (a: Hex, b: Hex): boolean => a.toLowerCase() === b.toLowerCase();

// Helper: Normalize L1 token address (FORMAL_ETH_ADDRESS → ETH_ADDRESS)
const normalizeL1Token = (token: Address): Address =>
  isAddressEq(token, FORMAL_ETH_ADDRESS) ? ETH_ADDRESS : token;

/**
 * Creates a tokens resource for managing token identity, L1/L2 mappings,
 * and bridge assetId primitives.
 *
 * @param client - EthersClient instance
 * @returns TokensResource instance
 */
export function createTokensResource(client: EthersClient): TokensResource {
  let l2NtvL1ChainIdPromise: Promise<bigint> | null = null;
  let baseTokenAssetIdPromise: Promise<Hex> | null = null;
  let wethL1Promise: Promise<Address> | null = null;
  let wethL2Promise: Promise<Address> | null = null;

  /**
   * Gets the L1 chain ID from L2 NTV
   */
  async function getL1ChainId(): Promise<bigint> {
    if (!l2NtvL1ChainIdPromise) {
      l2NtvL1ChainIdPromise = wrapAs('INTERNAL', 'getL1ChainId', async () => {
        const { l2NativeTokenVault } = await client.contracts();
        const chainId = (await l2NativeTokenVault.L1_CHAIN_ID()) as bigint;
        return chainId;
      });
    }
    return l2NtvL1ChainIdPromise;
  }

  /**
   * Gets the base token assetId from L2 NTV
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
   * Gets WETH address on L1
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
   * Gets WETH address on L2
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

  // Note: `l2TokenAddress` is now legacy way to get L2 token address for a given L1 token.
  // We will need to change this to `tokenAddress[assetId]` from the NTV
  // TODO: query the assetId on L1 using assetId mapping from l1TokenAddress https://github.com/matter-labs/era-contracts/blob/2855a3c54397d50e6925d486ae126ca8[…]3ec10fa1/l1-contracts/contracts/bridge/ntv/NativeTokenVault.sol
  // query the l2TokenAddress on l2 using assetId using tokenAddress mapping https://github.com/matter-labs/era-contracts/blob/2855a3c54397d50e6925d486ae126ca8[…]3ec10fa1/l1-contracts/contracts/bridge/ntv/NativeTokenVault.sol

  async function toL2Address(l1Token: Address): Promise<Address> {
    return wrapAs('CONTRACT', 'tokens.toL2Address', async () => {
      const normalized = normalizeL1Token(l1Token);

      // If token is the chain's base token on L1, return L2_BASE_TOKEN_ADDRESS
      const { chainId } = await client.l2.getNetwork();
      const baseToken = await client.baseToken(BigInt(chainId));
      if (isAddressEq(normalized, baseToken)) {
        return L2_BASE_TOKEN_ADDRESS;
      }

      // Query L2 NTV for L2 token address
      const { l2NativeTokenVault } = await client.contracts();
      const l2Token = (await l2NativeTokenVault.l2TokenAddress(normalized)) as Hex;
      return l2Token;
    });
  }

  async function toL1Address(l2Token: Address): Promise<Address> {
    return wrapAs('CONTRACT', 'tokens.toL1Address', async () => {
      // If L2 token is ETH, return canonical ETH_ADDRESS
      if (isAddressEq(l2Token, ETH_ADDRESS)) {
        return ETH_ADDRESS;
      }

      // If L2 token is the base token system address, return the L1 base token
      if (isAddressEq(l2Token, L2_BASE_TOKEN_ADDRESS)) {
        const { chainId } = await client.l2.getNetwork();
        return await client.baseToken(BigInt(chainId));
      }

      // Query L2 AssetRouter for L1 token address
      const { l2AssetRouter } = await client.contracts();
      const l1Token = (await l2AssetRouter.l1TokenAddress(l2Token)) as Hex;
      return l1Token;
    });
  }

  async function assetIdOfL1(l1Token: Address): Promise<Hex> {
    return wrapAs('CONTRACT', 'tokens.assetIdOfL1', async () => {
      const normalized = normalizeL1Token(l1Token);

      // Query L1 NTV for assetId
      const { l1NativeTokenVault } = await client.contracts();
      const assetId = (await l1NativeTokenVault.assetId(normalized)) as Hex;
      return assetId;
    });
  }

  async function assetIdOfL2(l2Token: Address): Promise<Hex> {
    return wrapAs('CONTRACT', 'tokens.assetIdOfL2', async () => {
      // Query L2 NTV for assetId
      const { l2NativeTokenVault } = await client.contracts();
      const assetId = (await l2NativeTokenVault.assetId(l2Token)) as Hex;
      return assetId;
    });
  }

  async function l2TokenFromAssetId(assetId: Hex): Promise<Address> {
    return wrapAs('CONTRACT', 'tokens.l2TokenFromAssetId', async () => {
      const { l2NativeTokenVault } = await client.contracts();
      const tokenAddr = (await l2NativeTokenVault.tokenAddress(assetId)) as Hex;
      return tokenAddr;
    });
  }

  async function l1TokenFromAssetId(assetId: Hex): Promise<Address> {
    return wrapAs('CONTRACT', 'tokens.l1TokenFromAssetId', async () => {
      const { l1NativeTokenVault } = await client.contracts();
      const tokenAddr = (await l1NativeTokenVault.tokenAddress(assetId)) as Hex;
      return tokenAddr;
    });
  }

  async function originChainId(assetId: Hex): Promise<bigint> {
    return wrapAs('CONTRACT', 'tokens.originChainId', async () => {
      const { l2NativeTokenVault } = await client.contracts();
      const chainId = (await l2NativeTokenVault.originChainId(assetId)) as bigint;
      return chainId;
    });
  }

  async function baseTokenAssetId(): Promise<Hex> {
    return getBaseTokenAssetId();
  }

  async function isChainEthBased(): Promise<boolean> {
    return wrapAs('CONTRACT', 'tokens.isChainEthBased', async () => {
      const baseAssetId = await getBaseTokenAssetId();
      const l1ChainId = await getL1ChainId();
      const ethAssetId = ntvCodec.encodeAssetId(
        l1ChainId,
        L2_NATIVE_TOKEN_VAULT_ADDRESS,
        ETH_ADDRESS,
      );

      return hexEq(baseAssetId, ethAssetId);
    });
  }

  async function wethL1(): Promise<Address> {
    return getWethL1();
  }

  async function wethL2(): Promise<Address> {
    return getWethL2();
  }

  async function computeL2BridgedAddress(args: {
    originChainId: bigint;
    l1Token: Address;
  }): Promise<Address> {
    return wrapAs('CONTRACT', 'tokens.computeL2BridgedAddress', async () => {
      const normalized = normalizeL1Token(args.l1Token);

      const { l2NativeTokenVault } = await client.contracts();
      const predicted = (await l2NativeTokenVault.calculateCreate2TokenAddress(
        args.originChainId,
        normalized,
      )) as Hex;
      return predicted;
    });
  }

  async function resolve(
    ref: Address | TokenRef,
    opts?: { chain?: 'l1' | 'l2' },
  ): Promise<ResolvedToken> {
    return wrapAs('CONTRACT', 'tokens.resolve', async () => {
      let chain: 'l1' | 'l2';
      let address: Address;

      if (typeof ref === 'string') {
        chain = opts?.chain ?? 'l1';
        address = ref;
      } else {
        chain = ref.chain;
        address = ref.address;
      }

      let l1: Address;
      let l2: Address;

      if (chain === 'l1') {
        l1 = normalizeL1Token(address);
        l2 = await toL2Address(address);
      } else {
        l2 = address;
        l1 = await toL1Address(address);
      }

      const assetId = await assetIdOfL1(l1);
      const originChainIdVal = await originChainId(assetId);

      const [baseAssetId, wethL1Addr, wethL2Addr, ethBased] = await Promise.all([
        baseTokenAssetId(),
        wethL1(),
        wethL2(),
        isChainEthBased(),
      ]);

      let kind: TokenKind;
      if (isAddressEq(l1, ETH_ADDRESS)) {
        kind = 'eth';
      } else if (hexEq(assetId, baseAssetId)) {
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
    computeL2BridgedAddress,
  };
}
