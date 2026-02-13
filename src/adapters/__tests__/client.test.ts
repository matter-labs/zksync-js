import { describe, it, expect } from 'bun:test';
import { Interface } from 'ethers';

import {
  ADAPTER_TEST_ADDRESSES,
  type AdapterHarness,
  describeForAdapters,
} from './adapter-harness';
import type { Address } from '../../core/types/primitives';
import { IBridgehubABI } from '../../core/abi';

const toLower = (value: Address) => value.toLowerCase();
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const IBridgehub = new Interface(IBridgehubABI as any);

function assertContractAddress(harness: AdapterHarness, contract: any, expected: Address) {
  if (harness.kind === 'ethers') {
    expect(contract.target.toLowerCase()).toBe(toLower(expected));
  } else {
    expect(contract.address.toLowerCase()).toBe(toLower(expected));
  }
}

describeForAdapters('adapters client', (kind, factory) => {
  it('ensureAddresses resolves dependencies and caches the result', async () => {
    const harness = factory();

    const resolved = await harness.client.ensureAddresses();
    expect(toLower(resolved.bridgehub)).toBe(toLower(ADAPTER_TEST_ADDRESSES.bridgehub));
    expect(toLower(resolved.l1AssetRouter)).toBe(toLower(ADAPTER_TEST_ADDRESSES.l1AssetRouter));
    expect(toLower(resolved.l1Nullifier)).toBe(toLower(ADAPTER_TEST_ADDRESSES.l1Nullifier));
    expect(toLower(resolved.l1NativeTokenVault)).toBe(
      toLower(ADAPTER_TEST_ADDRESSES.l1NativeTokenVault),
    );

    const again = await harness.client.ensureAddresses();
    expect(again).toBe(resolved);

    if (harness.kind === 'ethers') {
      expect((harness.client.signer as any).provider).toBe(harness.l1);
    } else {
      expect(harness.client.getL2Wallet()).toBe(harness.l2Wallet);
    }
  });

  it('contracts(): returns connected handles, caches them, and refresh() invalidates cache', async () => {
    const harness = factory();
    const resolved = await harness.client.ensureAddresses();

    const contracts = await harness.client.contracts();
    assertContractAddress(harness, contracts.bridgehub, resolved.bridgehub);
    assertContractAddress(harness, contracts.l1AssetRouter, resolved.l1AssetRouter);
    assertContractAddress(harness, contracts.l1Nullifier, resolved.l1Nullifier);
    assertContractAddress(harness, contracts.l1NativeTokenVault, resolved.l1NativeTokenVault);
    assertContractAddress(harness, contracts.l2AssetRouter, resolved.l2AssetRouter);
    assertContractAddress(harness, contracts.l2NativeTokenVault, resolved.l2NativeTokenVault);
    assertContractAddress(harness, contracts.l2BaseTokenSystem, resolved.l2BaseTokenSystem);

    const cached = await harness.client.contracts();
    expect(cached).toBe(contracts);

    harness.client.refresh();
    const afterRefresh = await harness.client.contracts();
    expect(afterRefresh).not.toBe(contracts);
  });

  it('baseToken(chainId) returns the value from Bridgehub.baseToken', async () => {
    const harness = factory();
    const baseToken = await harness.client.baseToken(324n);
    expect(toLower(baseToken)).toBe(toLower(ADAPTER_TEST_ADDRESSES.baseTokenFor324));
  });

  it('getSemverProtocolVersion resolves the registered CTM semver', async () => {
    const harness = factory();
    if (harness.kind !== 'ethers') {
      expect('getSemverProtocolVersion' in harness.client).toBe(false);
      return;
    }

    const semver = await harness.client.getSemverProtocolVersion();
    expect(semver).toEqual([0, 31, 0]);
  });

  it('getSemverProtocolVersion returns null when chain CTM is not registered', async () => {
    const harness = factory();
    if (harness.kind !== 'ethers') {
      expect('getSemverProtocolVersion' in harness.client).toBe(false);
      return;
    }

    harness.registry.set(
      ADAPTER_TEST_ADDRESSES.bridgehub,
      IBridgehub,
      'chainTypeManager',
      ZERO_ADDRESS,
      [324n],
    );

    const semver = await harness.client.getSemverProtocolVersion();
    expect(semver).toBeNull();
  });

  it('respects manual overrides without hitting discovery calls', async () => {
    const overrides = {
      bridgehub: '0x1000000000000000000000000000000000000001',
      l1AssetRouter: '0x2000000000000000000000000000000000000002',
      l1Nullifier: '0x3000000000000000000000000000000000000003',
      l1NativeTokenVault: '0x4000000000000000000000000000000000000004',
      l2AssetRouter: '0x5000000000000000000000000000000000000005',
      l2NativeTokenVault: '0x6000000000000000000000000000000000000006',
      l2BaseTokenSystem: '0x7000000000000000000000000000000000000007',
    } as Record<string, Address>;

    const harness = factory({ seed: false, overrides: overrides as any });
    const resolved = await harness.client.ensureAddresses();
    expect(resolved).toMatchObject(overrides);
  });
});
