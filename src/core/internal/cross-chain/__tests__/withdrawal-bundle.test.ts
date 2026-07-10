import { describe, expect, it } from 'bun:test';
import type { Address, Hex } from '../../../types/primitives';
import { buildWithdrawalBundle } from '../withdrawal-bundle';

const ASSET_ROUTER = '0x1111111111111111111111111111111111111111' as Address;
const PAYLOAD = '0x01aabb' as Hex;
const SALT = `0x${'22'.repeat(32)}` as Hex;

const codec = {
  formatChain: (chainId: bigint) => `0xchain${chainId}` as Hex,
  formatAddress: (address: Address) => `0xaddress${address.slice(2)}` as Hex,
};

const attributes = {
  call: {
    indirectCall: (value: bigint) => `0xindirect${value}` as Hex,
    interopCallValue: (value: bigint) => `0xcallvalue${value}` as Hex,
  },
  bundle: {
    executionAddress: () => '0x' as Hex,
    unbundlerAddress: () => '0x' as Hex,
    useFixedFee: () => '0x' as Hex,
    interopBundleSalt: (salt: Hex) => `0xsalt${salt.slice(2)}` as Hex,
  },
};

describe('cross-chain withdrawal bundle planning', () => {
  it('puts base-token value on indirectCall and msg.value only', () => {
    const bundle = buildWithdrawalBundle({
      kind: 'base',
      amount: 15n,
      l1ChainId: 1n,
      l2AssetRouter: ASSET_ROUTER,
      assetRouterPayload: PAYLOAD,
      salt: SALT,
      codec,
      attributes,
    });

    expect(bundle.dstChain).toBe('0xchain1');
    expect(bundle.starters).toEqual([
      [`0xaddress${ASSET_ROUTER.slice(2)}`, PAYLOAD, ['0xindirect15', '0xcallvalue0']],
    ]);
    expect(bundle.transactionValue).toBe(15n);
    expect(bundle.protocolFee).toBe(0n);
    expect(bundle.bundleAttributes).toEqual([`0xsalt${SALT.slice(2)}`]);
  });

  it('keeps ERC-20 value entirely inside the bridge payload', () => {
    const bundle = buildWithdrawalBundle({
      kind: 'erc20',
      amount: 15n,
      l1ChainId: 1n,
      l2AssetRouter: ASSET_ROUTER,
      assetRouterPayload: PAYLOAD,
      salt: SALT,
      codec,
      attributes,
    });

    expect(bundle.starters[0][2]).toEqual(['0xindirect0', '0xcallvalue0']);
    expect(bundle.transactionValue).toBe(0n);
    expect(bundle.protocolFee).toBe(0n);
  });
});
