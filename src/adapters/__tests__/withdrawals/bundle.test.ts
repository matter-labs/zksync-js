import { AbiCoder, Interface } from 'ethers';
import { describe, expect, it } from 'bun:test';
import { routeEthBaseBundle as routeEthersEth } from '../../ethers/resources/withdrawals/routes/bundle';
import { routeErc20NonBaseBundle as routeEthersErc20 } from '../../ethers/resources/withdrawals/routes/bundle';
import { routeEthBaseBundle as routeViemEth } from '../../viem/resources/withdrawals/routes/bundle';
import { routeErc20NonBaseBundle as routeViemErc20 } from '../../viem/resources/withdrawals/routes/bundle';
import { interopCodec as ethersCodec } from '../../ethers/resources/interop/address';
import { interopCodec as viemCodec } from '../../viem/resources/interop/address';
import {
  describeForAdapters,
  makeWithdrawalContext,
  setErc20Allowance,
  setL2TokenRegistration,
} from '../adapter-harness';
import { parseSendBundleTx } from '../decode-helpers';
import { IERC7786AttributesABI } from '../../../core/abi';
import {
  ETH_ADDRESS,
  FORMAL_ETH_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  L2_INTEROP_CENTER_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
} from '../../../core/constants';
import type { Address, Hex } from '../../../core/types/primitives';

const BASE_ASSET_ID = `0x${'11'.repeat(32)}` as Hex;
const ERC20_ASSET_ID = `0x${'22'.repeat(32)}` as Hex;
const ERC20 = '0x3333333333333333333333333333333333333333' as Address;
const RECIPIENT = '0x4444444444444444444444444444444444444444' as Address;
const ATTRIBUTES = new Interface(IERC7786AttributesABI);
const ABI = AbiCoder.defaultAbiCoder();

const ROUTES = {
  ethers: {
    eth: routeEthersEth,
    erc20: routeEthersErc20,
    codec: ethersCodec,
  },
  viem: {
    eth: routeViemEth,
    erc20: routeViemErc20,
    codec: viemCodec,
  },
} as const;

function deterministicBytes(value: number) {
  return () => new Uint8Array(32).fill(value);
}

function setL1ChainId(kind: 'ethers' | 'viem', harness: any, chainId: bigint) {
  if (kind === 'ethers') {
    harness.l1.getNetwork = async () => ({ chainId });
  } else {
    harness.l1.getChainId = async () => Number(chainId);
  }
}

function decodeStarterPayload(data: string) {
  expect(data.slice(0, 4)).toBe('0x01');
  const [assetId, transferData] = ABI.decode(['bytes32', 'bytes'], `0x${data.slice(4)}`);
  const [amount, receiver, token] = ABI.decode(['uint256', 'address', 'address'], transferData);
  return {
    assetId: assetId as Hex,
    amount: amount as bigint,
    receiver: (receiver as string).toLowerCase(),
    token: (token as string).toLowerCase(),
  };
}

describeForAdapters('adapters/withdrawals/bundle planning', (kind, factory) => {
  it('builds exact base-token L2-to-L1 sendBundle calldata', async () => {
    const harness = factory();
    setL1ChainId(kind, harness, 1n);
    const ctx = makeWithdrawalContext(harness, {
      baseTokenAssetId: BASE_ASSET_ID,
      baseTokenL1: ETH_ADDRESS,
      l2AssetRouter: L2_ASSET_ROUTER_ADDRESS,
    });
    const amount = 1_234n;
    const route = ROUTES[kind].eth({ randomBytes: deterministicBytes(7) });

    const result = await route.build({ token: ETH_ADDRESS, amount, to: RECIPIENT }, ctx as any);

    expect(result.approvals).toEqual([]);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].key).toBe('l2-base-token:withdraw');
    const bundle = parseSendBundleTx(result.steps[0].tx);
    expect(bundle.to).toBe(L2_INTEROP_CENTER_ADDRESS.toLowerCase());
    expect(bundle.value).toBe(amount);
    expect(bundle.destinationChainId).toBe(ROUTES[kind].codec.formatChain(1n));
    expect(bundle.callStarters).toHaveLength(1);

    const starter = bundle.callStarters[0];
    expect(starter.to).toBe(ROUTES[kind].codec.formatAddress(L2_ASSET_ROUTER_ADDRESS));
    expect(decodeStarterPayload(starter.data)).toEqual({
      assetId: BASE_ASSET_ID,
      amount,
      receiver: RECIPIENT.toLowerCase(),
      token: FORMAL_ETH_ADDRESS,
    });
    expect(ATTRIBUTES.decodeFunctionData('indirectCall', starter.callAttributes[0])[0]).toBe(
      amount,
    );
    expect(ATTRIBUTES.decodeFunctionData('interopCallValue', starter.callAttributes[1])[0]).toBe(
      0n,
    );
    expect(ATTRIBUTES.decodeFunctionData('interopBundleSalt', bundle.bundleAttributes[0])[0]).toBe(
      `0x${'07'.repeat(32)}`,
    );
  });

  it('builds exact ERC-20 L2-to-L1 sendBundle calldata with zero msg.value', async () => {
    const harness = factory();
    setL1ChainId(kind, harness, 1n);
    const ctx = makeWithdrawalContext(harness, {
      baseTokenAssetId: BASE_ASSET_ID,
      baseTokenL1: ETH_ADDRESS,
      l2AssetRouter: L2_ASSET_ROUTER_ADDRESS,
      l2NativeTokenVault: L2_NATIVE_TOKEN_VAULT_ADDRESS,
    });
    const amount = 4_321n;
    setErc20Allowance(harness, ERC20, ctx.sender, ctx.l2NativeTokenVault, amount);
    setL2TokenRegistration(harness, ctx.l2NativeTokenVault, ERC20, ERC20_ASSET_ID);
    const route = ROUTES[kind].erc20({ randomBytes: deterministicBytes(8) });

    const result = await route.build({ token: ERC20, amount, to: RECIPIENT }, ctx as any);

    expect(result.approvals).toEqual([]);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].key).toBe('l2-asset-router:withdraw');
    const bundle = parseSendBundleTx(result.steps[0].tx);
    expect(bundle.value).toBe(0n);
    expect(decodeStarterPayload(bundle.callStarters[0].data)).toEqual({
      assetId: ERC20_ASSET_ID,
      amount,
      receiver: RECIPIENT.toLowerCase(),
      token: ERC20.toLowerCase(),
    });
    expect(
      ATTRIBUTES.decodeFunctionData('indirectCall', bundle.callStarters[0].callAttributes[0])[0],
    ).toBe(0n);
    expect(
      ATTRIBUTES.decodeFunctionData(
        'interopCallValue',
        bundle.callStarters[0].callAttributes[1],
      )[0],
    ).toBe(0n);
  });

  it('retains the NTV approval intent before sendBundle', async () => {
    const harness = factory();
    setL1ChainId(kind, harness, 1n);
    const ctx = makeWithdrawalContext(harness, {
      baseTokenAssetId: BASE_ASSET_ID,
      baseTokenL1: ETH_ADDRESS,
      l2AssetRouter: L2_ASSET_ROUTER_ADDRESS,
      l2NativeTokenVault: L2_NATIVE_TOKEN_VAULT_ADDRESS,
    });
    setErc20Allowance(harness, ERC20, ctx.sender, ctx.l2NativeTokenVault, 0n);
    setL2TokenRegistration(harness, ctx.l2NativeTokenVault, ERC20, ERC20_ASSET_ID);

    const result = await ROUTES[kind]
      .erc20({ randomBytes: deterministicBytes(9) })
      .build({ token: ERC20, amount: 10n }, ctx as any);

    expect(result.approvals).toEqual([
      { token: ERC20, spender: ctx.l2NativeTokenVault, amount: 10n },
    ]);
    expect(result.steps.map((step) => step.key)).toEqual([
      `approve:l2:${ERC20}:${ctx.l2NativeTokenVault}`,
      'l2-asset-router:withdraw',
    ]);
  });
});

describe('withdrawal bundle salt generation', () => {
  it('requests a fresh salt for every planned bundle', async () => {
    let next = 1;
    const harness = (await import('../adapter-harness')).createAdapterHarness('ethers');
    setL1ChainId('ethers', harness, 1n);
    const ctx = makeWithdrawalContext(harness, {
      baseTokenAssetId: BASE_ASSET_ID,
      baseTokenL1: ETH_ADDRESS,
    });
    const route = routeEthersEth({
      randomBytes: () => new Uint8Array(32).fill(next++),
    });

    const first = parseSendBundleTx(
      (await route.build({ token: ETH_ADDRESS, amount: 1n }, ctx as any)).steps[0].tx,
    );
    const second = parseSendBundleTx(
      (await route.build({ token: ETH_ADDRESS, amount: 1n }, ctx as any)).steps[0].tx,
    );

    expect(first.bundleAttributes[0]).not.toBe(second.bundleAttributes[0]);
  });
});
