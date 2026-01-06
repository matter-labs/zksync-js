// src/adapters/viem/resources/tokens/tokens.ts

import { encodeAbiParameters, keccak256, type Abi, type Hex as ViemHex } from 'viem';
import type { ViemClient } from '../../client';
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
import { IL2AssetRouterABI, L2NativeTokenVaultABI, L1NativeTokenVaultABI } from '../../../../core/abi';

const { wrapAs } = createErrorHandlers('tokens');

const ntvCodec = createNTVCodec({
  encode: (types, values) =>
    encodeAbiParameters(
      types.map((t, i) => ({ type: t, name: `arg${i}` })),
      values,
    ) as Hex,
  keccak256: (data: ViemHex) => keccak256(data) as Hex,
});

// Helper: case-insensitive hex equality
const hexEq = (a: Hex, b: Hex): boolean => a.toLowerCase() === b.toLowerCase();

// Normalize L1 token address (FORMAL_ETH_ADDRESS → ETH_ADDRESS)
const normalizeL1Token = (token: Address): Address =>
  isAddressEq(token, FORMAL_ETH_ADDRESS) ? ETH_ADDRESS : token;

export function createTokensResource(client: ViemClient): TokensResource {
  let l2NtvL1ChainIdPromise: Promise<bigint> | null = null;
  let baseTokenAssetIdPromise: Promise<Hex> | null = null;
  let wethL1Promise: Promise<Address> | null = null;
  let wethL2Promise: Promise<Address> | null = null;

  async function getL1ChainId(): Promise<bigint> {
    if (!l2NtvL1ChainIdPromise) {
      l2NtvL1ChainIdPromise = wrapAs('INTERNAL', 'getL1ChainId', async () => {
        const { l2NativeTokenVault } = await client.contracts();
        return (await l2NativeTokenVault.read.L1_CHAIN_ID()) as bigint;
      });
    }
    return l2NtvL1ChainIdPromise;
  }

  async function getBaseTokenAssetId(): Promise<Hex> {
    if (!baseTokenAssetIdPromise) {
      baseTokenAssetIdPromise = wrapAs('INTERNAL', 'baseTokenAssetId', async () => {
        const { l2NativeTokenVault } = await client.contracts();
        const assetId = (await l2NativeTokenVault.read.BASE_TOKEN_ASSET_ID()) as string;
        return assetId as Hex;
      });
    }
    return baseTokenAssetIdPromise;
  }

  async function getWethL1(): Promise<Address> {
    if (!wethL1Promise) {
      wethL1Promise = wrapAs('INTERNAL', 'wethL1', async () => {
        const { l1NativeTokenVault } = await client.contracts();
        const weth = (await l1NativeTokenVault.read.WETH_TOKEN()) as string;
        return weth as Address;
      });
    }
    return wethL1Promise;
  }

  async function getWethL2(): Promise<Address> {
    if (!wethL2Promise) {
      wethL2Promise = wrapAs('INTERNAL', 'wethL2', async () => {
        const { l2NativeTokenVault } = await client.contracts();
        const weth = (await l2NativeTokenVault.read.WETH_TOKEN()) as string;
        return weth as Address;
      });
    }
    return wethL2Promise;
  }

  async function toL2Address(l1Token: Address): Promise<Address> {
    return wrapAs('CONTRACT', 'tokens.toL2Address', async () => {
      const normalized = normalizeL1Token(l1Token);

      const chainId = BigInt(await client.l2.getChainId());
      const baseToken = await client.baseToken(chainId);
      if (isAddressEq(normalized, baseToken)) {
        return L2_BASE_TOKEN_ADDRESS;
      }

      const { l2NativeTokenVault } = await client.contracts();
      const l2Token = (await l2NativeTokenVault.read.l2TokenAddress([normalized])) as Hex;
      return l2Token as Address;
    });
  }

  async function toL1Address(l2Token: Address): Promise<Address> {
    return wrapAs('CONTRACT', 'tokens.toL1Address', async () => {
      if (isAddressEq(l2Token, ETH_ADDRESS)) return ETH_ADDRESS;
      if (isAddressEq(l2Token, L2_BASE_TOKEN_ADDRESS)) {
        const chainId = BigInt(await client.l2.getChainId());
        return await client.baseToken(chainId);
      }

      const { l2AssetRouter } = await client.contracts();
      const l1Token = (await l2AssetRouter.read.l1TokenAddress([l2Token])) as Hex;
      return l1Token as Address;
    });
  }

  async function assetIdOfL1(l1Token: Address): Promise<Hex> {
    return wrapAs('CONTRACT', 'tokens.assetIdOfL1', async () => {
      const normalized = normalizeL1Token(l1Token);
      const { l1NativeTokenVault } = await client.contracts();
      return (await l1NativeTokenVault.read.assetId([normalized])) as Hex;
    });
  }

  async function assetIdOfL2(l2Token: Address): Promise<Hex> {
    return wrapAs('CONTRACT', 'tokens.assetIdOfL2', async () => {
      const { l2NativeTokenVault } = await client.contracts();
      return (await l2NativeTokenVault.read.assetId([l2Token])) as Hex;
    });
  }

  async function l2TokenFromAssetId(assetId: Hex): Promise<Address> {
    return wrapAs('CONTRACT', 'tokens.l2TokenFromAssetId', async () => {
      const { l2NativeTokenVault } = await client.contracts();
      return (await l2NativeTokenVault.read.tokenAddress([assetId])) as Address;
    });
  }

  async function l1TokenFromAssetId(assetId: Hex): Promise<Address> {
    return wrapAs('CONTRACT', 'tokens.l1TokenFromAssetId', async () => {
      const { l1NativeTokenVault } = await client.contracts();
      return (await l1NativeTokenVault.read.tokenAddress([assetId])) as Address;
    });
  }

  async function originChainId(assetId: Hex): Promise<bigint> {
    return wrapAs('CONTRACT', 'tokens.originChainId', async () => {
      const { l2NativeTokenVault } = await client.contracts();
      return (await l2NativeTokenVault.read.originChainId([assetId])) as bigint;
    });
  }

  async function baseTokenAssetId(): Promise<Hex> {
    return getBaseTokenAssetId();
  }

  async function isChainEthBased(): Promise<boolean> {
    return wrapAs('CONTRACT', 'tokens.isChainEthBased', async () => {
      const baseAssetId = await getBaseTokenAssetId();
      const l1ChainId = await getL1ChainId();
      const ethAssetId = ntvCodec.encodeAssetId(l1ChainId, L2_NATIVE_TOKEN_VAULT_ADDRESS, ETH_ADDRESS);
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
      const predicted = (await l2NativeTokenVault.read.calculateCreate2TokenAddress([
        args.originChainId,
        normalized,
      ])) as Hex;
      return predicted as Address;
    });
  }

  async function resolve(ref: Address | TokenRef, opts?: { chain?: 'l1' | 'l2' }): Promise<ResolvedToken> {
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
