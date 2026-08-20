// tests/withdrawals/bundle.test.ts
import { describe, it, expect } from 'bun:test';
import { AbiCoder, Interface, concat, keccak256 } from 'ethers';

import { buildWithdrawalBundle, withdrawalBundleSalt } from '../bundle';
import { createAttributesResource } from '../../interop/attributes/resource';
import IERC7786AttributesAbi from '../../../internal/abis/IERC7786Attributes';
import { FORMAL_ETH_ADDRESS, L2_ASSET_ROUTER_ADDRESS } from '../../../constants';
import type { Address, Hex } from '../../../types/primitives';

// Mirrors the ethers/viem adapters, so the assertions below exercise the real encodings.
const iface = new Interface(IERC7786AttributesAbi);
const attributesResource = createAttributesResource({
  encode: (fn, args) => iface.encodeFunctionData(fn, args) as Hex,
});

const attributes = {
  indirectCall: attributesResource.call.indirectCall,
  interopCallValue: attributesResource.call.interopCallValue,
  interopBundleSalt: attributesResource.bundle.interopBundleSalt,
};

const transferData = {
  encodeBridgeBurnData: (amount: bigint, receiver: Address, token: Address): Hex =>
    AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'address'],
      [amount, receiver, token],
    ) as Hex,
  encodeAssetRouterDepositData: (assetId: Hex, data: Hex): Hex =>
    concat([
      '0x01',
      AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes'], [assetId, data]),
    ]) as Hex,
};

// Trivial ERC-7930 stand-ins: the builder only has to place them, not interpret them.
const codec = {
  formatChain: (chainId: bigint): Hex => `0xcccc${chainId.toString(16).padStart(4, '0')}` as Hex,
  formatAddress: (address: Address): Hex => `0xaaaa${address.slice(2)}` as Hex,
};

const ASSET_ID = `0x${'11'.repeat(32)}` as Hex;
const SALT = `0x${'22'.repeat(32)}` as Hex;
const RECEIVER = '0x1111111111111111111111111111111111111111' as Address;
const TOKEN = '0x2222222222222222222222222222222222222222' as Address;
const L1_CHAIN_ID = 1n;
const AMOUNT = 10n ** 18n;

function build(overrides: { isBaseToken: boolean; l2Token: Address }) {
  return buildWithdrawalBundle({
    assetId: ASSET_ID,
    amount: AMOUNT,
    l1Receiver: RECEIVER,
    l2Token: overrides.l2Token,
    isBaseToken: overrides.isBaseToken,
    l1ChainId: L1_CHAIN_ID,
    l2AssetRouter: L2_ASSET_ROUTER_ADDRESS,
    salt: SALT,
    codec,
    attributes,
    transferData,
  });
}

describe('withdrawals/buildWithdrawalBundle', () => {
  it('builds a single-call bundle targeting the L2 asset router on the L1 chain', () => {
    const bundle = build({ isBaseToken: false, l2Token: TOKEN });

    expect(bundle.destinationChain).toBe(codec.formatChain(L1_CHAIN_ID));
    expect(bundle.starters).toHaveLength(1);

    const [to, data, callAttributes] = bundle.starters[0];
    expect(to).toBe(codec.formatAddress(L2_ASSET_ROUTER_ADDRESS));
    // v1 asset-router deposit encoding is version-prefixed.
    expect(data.startsWith('0x01')).toBe(true);
    expect(callAttributes).toHaveLength(2);
  });

  it('forwards the amount as indirect-call message value for a base-token withdrawal', () => {
    const bundle = build({ isBaseToken: true, l2Token: FORMAL_ETH_ADDRESS });

    // The withdrawn base token rides along as msg.value on `sendBundle`...
    expect(bundle.value).toBe(AMOUNT);

    const [, , callAttributes] = bundle.starters[0];
    const indirect = iface.decodeFunctionData('indirectCall', callAttributes[0]);
    expect(indirect[0]).toBe(AMOUNT);

    // ...and never as interopCallValue, which the asset router handles on the L1 side instead.
    const callValue = iface.decodeFunctionData('interopCallValue', callAttributes[1]);
    expect(callValue[0]).toBe(0n);
  });

  it('carries no value for an ERC-20 withdrawal — the vault pulls the tokens instead', () => {
    const bundle = build({ isBaseToken: false, l2Token: TOKEN });

    expect(bundle.value).toBe(0n);

    const [, , callAttributes] = bundle.starters[0];
    expect(iface.decodeFunctionData('indirectCall', callAttributes[0])[0]).toBe(0n);
    expect(iface.decodeFunctionData('interopCallValue', callAttributes[1])[0]).toBe(0n);
  });

  it('leaves the burn token zero for a base-token withdrawal so the vault resolves it', () => {
    const bundle = build({ isBaseToken: true, l2Token: FORMAL_ETH_ADDRESS });
    const [, data] = bundle.starters[0];

    const [assetId, burnData] = AbiCoder.defaultAbiCoder().decode(
      ['bytes32', 'bytes'],
      `0x${data.slice(4)}`,
    ) as [Hex, Hex];
    const [amount, receiver, token] = AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'address', 'address'],
      burnData,
    ) as [bigint, Address, Address];

    expect(assetId).toBe(ASSET_ID);
    expect(amount).toBe(AMOUNT);
    expect(receiver.toLowerCase()).toBe(RECEIVER.toLowerCase());
    expect(token).toBe(FORMAL_ETH_ADDRESS);
  });

  it('names the L2 token in the burn for an ERC-20 withdrawal', () => {
    const bundle = build({ isBaseToken: false, l2Token: TOKEN });
    const [, data] = bundle.starters[0];

    const [, burnData] = AbiCoder.defaultAbiCoder().decode(
      ['bytes32', 'bytes'],
      `0x${data.slice(4)}`,
    ) as [Hex, Hex];
    const [, , token] = AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'address', 'address'],
      burnData,
    ) as [bigint, Address, Address];

    expect(token.toLowerCase()).toBe(TOKEN.toLowerCase());
  });

  it('attaches the bundle salt and no atomicBundle attribute', () => {
    const bundle = build({ isBaseToken: false, l2Token: TOKEN });

    expect(bundle.bundleAttributes).toHaveLength(1);
    expect(iface.decodeFunctionData('interopBundleSalt', bundle.bundleAttributes[0])[0]).toBe(SALT);

    // L2→L1 withdrawals are non-atomic: they are published to L1, not committed to the IMT.
    const atomicSelector = iface.getFunction('atomicBundle')?.selector;
    expect(atomicSelector).toBeUndefined();
  });
});

describe('withdrawals/withdrawalBundleSalt', () => {
  it('derives the salt from (sender, nonce) so it is fresh but reproducible', () => {
    const hash = (sender: Address, nonce: bigint): Hex =>
      keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [sender, nonce])) as Hex;

    const a = withdrawalBundleSalt({ sender: RECEIVER, nonce: 7, hash });
    const again = withdrawalBundleSalt({ sender: RECEIVER, nonce: 7, hash });
    const next = withdrawalBundleSalt({ sender: RECEIVER, nonce: 8, hash });
    const other = withdrawalBundleSalt({ sender: TOKEN, nonce: 7, hash });

    expect(a).toBe(again);
    expect(a).not.toBe(next);
    expect(a).not.toBe(other);
  });
});
