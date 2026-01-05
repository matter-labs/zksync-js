import { describe, it, expect } from 'bun:test';
import { Interface, AbiCoder, ethers } from 'ethers';

import { createTokensResource } from '../ethers/resources/tokens';
import { createEthersHarness, ADAPTER_TEST_ADDRESSES } from './adapter-harness';
import {
  ETH_ADDRESS,
  FORMAL_ETH_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  L2_BASE_TOKEN_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
} from '../../core/constants';
import { IL2AssetRouterABI, L1NativeTokenVaultABI, L2NativeTokenVaultABI } from '../../core/abi';
import { createNTVCodec } from '../../core/codec/ntv';

const L1NTV = new Interface(L1NativeTokenVaultABI as any);
const L2NTV = new Interface(L2NativeTokenVaultABI as any);
const L2AR = new Interface(IL2AssetRouterABI as any);

const ntvCodec = createNTVCodec({
  encode: (types, values) => AbiCoder.defaultAbiCoder().encode(types, values) as `0x${string}`,
  keccak256: (data: `0x${string}`) => ethers.keccak256(data) as `0x${string}`,
});

describe('adapters/tokens (ethers)', () => {
  it('resolves a non-base ERC20 with L1/L2 mapping and facts', async () => {
    const harness = createEthersHarness();
    const tokens = createTokensResource(harness.client);

    const l1Token = '0x0000000000000000000000000000000000000111' as const;
    const l2Token = '0x0000000000000000000000000000000000000222' as const;
    const assetId = '0xaaa0000000000000000000000000000000000000000000000000000000000001' as const;
    const baseTokenAssetId =
      '0xbbb0000000000000000000000000000000000000000000000000000000000002' as const;

    // Base chain facts
    harness.registry.set(ADAPTER_TEST_ADDRESSES.l1NativeTokenVault, L1NTV, 'assetId', assetId, [
      l1Token,
    ]);
    harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'assetId', assetId, [l2Token]);
    harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'tokenAddress', l2Token, [assetId]);
    harness.registry.set(
      ADAPTER_TEST_ADDRESSES.l1NativeTokenVault,
      L1NTV,
      'tokenAddress',
      l1Token,
      [assetId],
    );
    harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'originChainId', 9n, [assetId]);
    harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'l2TokenAddress', l2Token, [
      l1Token,
    ]);
    harness.registry.set(L2_ASSET_ROUTER_ADDRESS, L2AR, 'l1TokenAddress', l1Token, [l2Token]);
    harness.registry.set(
      L2_NATIVE_TOKEN_VAULT_ADDRESS,
      L2NTV,
      'BASE_TOKEN_ASSET_ID',
      baseTokenAssetId,
    );
    harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'L1_CHAIN_ID', 1n);
    harness.registry.set(
      ADAPTER_TEST_ADDRESSES.l1NativeTokenVault,
      L1NTV,
      'WETH_TOKEN',
      ADAPTER_TEST_ADDRESSES.baseTokenFor324,
    );
    harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'WETH_TOKEN', L2_BASE_TOKEN_ADDRESS);

    const resolved = await tokens.resolve(l1Token);
    expect(resolved.kind).toBe('erc20');
    expect(resolved.l1.toLowerCase()).toBe(l1Token.toLowerCase());
    expect(resolved.l2.toLowerCase()).toBe(l2Token.toLowerCase());
    expect(resolved.assetId.toLowerCase()).toBe(assetId.toLowerCase());
    expect(resolved.baseTokenAssetId.toLowerCase()).toBe(baseTokenAssetId.toLowerCase());
    expect(resolved.originChainId).toBe(9n);
    expect(resolved.isChainEthBased).toBe(false);
    expect(resolved.wethL1.toLowerCase()).toBe(
      ADAPTER_TEST_ADDRESSES.baseTokenFor324.toLowerCase(),
    );
    expect(resolved.wethL2.toLowerCase()).toBe(L2_BASE_TOKEN_ADDRESS.toLowerCase());
  });

  it('detects ETH-based chains via baseTokenAssetId', async () => {
    const harness = createEthersHarness();
    const tokens = createTokensResource(harness.client);

    const ethAssetId = ntvCodec.encodeAssetId(1n, L2_NATIVE_TOKEN_VAULT_ADDRESS, ETH_ADDRESS);
    harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'BASE_TOKEN_ASSET_ID', ethAssetId);
    harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'L1_CHAIN_ID', 1n);

    const isEthBased = await tokens.isChainEthBased();
    expect(isEthBased).toBe(true);
  });

  it('normalizes ETH aliases for CREATE2 predictions and base-token alias mapping', async () => {
    const harness = createEthersHarness();
    const tokens = createTokensResource(harness.client);

    const predicted = '0x0000000000000000000000000000000000000c0d' as const;
    harness.registry.set(
      L2_NATIVE_TOKEN_VAULT_ADDRESS,
      L2NTV,
      'calculateCreate2TokenAddress',
      predicted,
      [1n, ETH_ADDRESS],
    );

    const computed = await tokens.computeL2BridgedAddress({
      originChainId: 1n,
      l1Token: FORMAL_ETH_ADDRESS,
    });
    expect(computed.toLowerCase()).toBe(predicted.toLowerCase());

    // Base-token alias should map back to L1 base token for the chain
    const baseL1 = await tokens.toL1Address(L2_BASE_TOKEN_ADDRESS);
    expect(baseL1.toLowerCase()).toBe(ADAPTER_TEST_ADDRESSES.baseTokenFor324.toLowerCase());
  });
});
