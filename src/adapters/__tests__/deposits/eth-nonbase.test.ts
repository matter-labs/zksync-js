import { describe, expect, it } from 'bun:test';

import { createDepositsResource } from '../../ethers/resources/deposits/index.ts';
import { routeEthNonBase as routeEthers } from '../../ethers/resources/deposits/routes/eth-nonbase.ts';
import { routeEthNonBase as routeViem } from '../../viem/resources/deposits/routes/eth-nonbase.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  createEthersHarness,
  describeForAdapters,
  makeDepositContext,
  setBridgehubBaseCost,
  setErc20Allowance,
} from '../adapter-harness.ts';
import {
  decodeSecondBridgeErc20,
  decodeTwoBridgeOuter,
  parseApproveTx,
} from '../decode-helpers.ts';
import { ETH_ADDRESS, FORMAL_ETH_ADDRESS, SAFE_L1_BRIDGE_GAS } from '../../../core/constants.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';
import type { TokensResource, ResolvedToken } from '../../../core/types/flows/token.ts';
import type { Address, Hex } from '../../../core/types/primitives.ts';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

const MIN_L2_GAS_FOR_ETH_NONBASE = 600_000n;
const SAFE_NONBASE_L2_GAS_LIMIT = 3_000_000n;
const BASE_TOKEN = ADAPTER_TEST_ADDRESSES.baseTokenFor324;
const RECEIVER = '0x4444444444444444444444444444444444444444' as Address;
const BASE_TOKEN_ASSET_ID = `0x${'11'.repeat(32)}` as Hex;
const ETH_ASSET_ID = `0x${'22'.repeat(32)}` as Hex;
const WETH_L1 = '0x5555555555555555555555555555555555555555' as Address;
const WETH_L2 = '0x6666666666666666666666666666666666666666' as Address;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

function makeResolvedEthToken(l2Token: Address = ETH_ADDRESS): ResolvedToken {
  return {
    kind: 'eth',
    l1: FORMAL_ETH_ADDRESS,
    l2: l2Token,
    assetId: ETH_ASSET_ID,
    originChainId: 1n,
    isChainEthBased: false,
    baseTokenAssetId: BASE_TOKEN_ASSET_ID,
    wethL1: WETH_L1,
    wethL2: WETH_L2,
  };
}

function makeEthNonBaseTokens(baseToken: Address, l2Token: Address = ETH_ADDRESS): TokensResource {
  const resolved = makeResolvedEthToken(l2Token);

  return {
    async resolve() {
      return resolved;
    },
    async l1TokenFromAssetId() {
      return baseToken;
    },
  } as TokensResource;
}

describeForAdapters('adapters/deposits/routeEthNonBase', (kind, factory) => {
  it('adds a spender-qualified base-token approval when allowance is insufficient', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness, {
      l2GasLimit: MIN_L2_GAS_FOR_ETH_NONBASE,
      baseTokenL1: BASE_TOKEN,
      baseIsEth: false,
      resolvedToken: makeResolvedEthToken(),
    });
    const amount = 5_000n;
    const baseCost = 4_000n;
    const mintValue = baseCost + ctx.operatorTip;

    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: MIN_L2_GAS_FOR_ETH_NONBASE });
    setErc20Allowance(harness, BASE_TOKEN, ctx.sender, ctx.l1AssetRouter, mintValue - 1n);

    const res = await ROUTES[kind].build(
      { token: FORMAL_ETH_ADDRESS, amount, to: RECEIVER } as any,
      ctx as any,
    );

    expect(res.approvals.length).toBe(1);
    expect(res.steps.length).toBe(2);
    expect(res.fees?.token.toLowerCase()).toBe(BASE_TOKEN.toLowerCase());
    expect(res.fees?.l2.baseCost).toBe(baseCost);
    expect(res.fees?.mintValue).toBe(mintValue);

    const [approvalNeed] = res.approvals;
    expect(approvalNeed.token.toLowerCase()).toBe(BASE_TOKEN.toLowerCase());
    expect(approvalNeed.spender.toLowerCase()).toBe(ctx.l1AssetRouter.toLowerCase());
    expect(approvalNeed.amount).toBe(mintValue);

    const [approve, bridge] = res.steps;
    expect(approve.kind).toBe('approve');
    expect(approve.key).toBe(`approve:${BASE_TOKEN}:${ctx.l1AssetRouter}`);

    const approveInfo = parseApproveTx(kind, approve.tx);
    expect(approveInfo.to).toBe(BASE_TOKEN.toLowerCase());
    expect(approveInfo.spender).toBe(ctx.l1AssetRouter.toLowerCase());
    expect(approveInfo.amount).toBe(mintValue);

    expect(bridge.key).toBe('bridgehub:two-bridges:eth-nonbase');

    if (kind === 'ethers') {
      const tx = bridge.tx as any;
      const info = decodeTwoBridgeOuter(tx.data);
      const bridgeArgs = decodeSecondBridgeErc20(info.secondBridgeCalldata);

      expect((tx.to as string).toLowerCase()).toBe(ADAPTER_TEST_ADDRESSES.bridgehub.toLowerCase());
      expect((tx.from as string).toLowerCase()).toBe(ctx.sender.toLowerCase());
      expect(BigInt(tx.value ?? 0n)).toBe(amount);
      expect(BigInt(info.mintValue)).toBe(mintValue);
      expect(BigInt(info.secondBridgeValue)).toBe(amount);
      expect(bridgeArgs.token).toBe(ETH_ADDRESS.toLowerCase());
      expect(bridgeArgs.amount).toBe(amount);
      expect(bridgeArgs.receiver).toBe(RECEIVER.toLowerCase());
    } else {
      const tx = bridge.tx as any;
      const req = (tx.args?.[0] ?? {}) as any;

      expect((tx.address as string).toLowerCase()).toBe(
        ADAPTER_TEST_ADDRESSES.bridgehub.toLowerCase(),
      );
      expect((tx.account as string).toLowerCase()).toBe(ctx.sender.toLowerCase());
      expect(BigInt(tx.value ?? 0n)).toBe(amount);
      expect(BigInt(req.mintValue ?? 0n)).toBe(mintValue);
      expect(BigInt(req.secondBridgeValue ?? 0n)).toBe(amount);
    }
  });

  it('uses a safe L2 gas limit when the bridged ETH token is not yet deployed on L2', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness, {
      l2GasLimit: undefined,
      baseTokenL1: BASE_TOKEN,
      baseIsEth: false,
      resolvedToken: makeResolvedEthToken(ZERO_ADDRESS),
    });
    const amount = 3_000n;
    const baseCost = 9_000n;
    const mintValue = baseCost + ctx.operatorTip;

    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: SAFE_NONBASE_L2_GAS_LIMIT });
    setErc20Allowance(harness, BASE_TOKEN, ctx.sender, ctx.l1AssetRouter, mintValue);

    const res = await ROUTES[kind].build(
      { token: FORMAL_ETH_ADDRESS, amount, to: RECEIVER } as any,
      ctx as any,
    );

    expect(res.approvals.length).toBe(0);
    expect(res.fees?.l2.baseCost).toBe(baseCost);
    expect(res.fees?.mintValue).toBe(mintValue);

    const bridge = res.steps.at(-1)!;
    if (kind === 'ethers') {
      const info = decodeTwoBridgeOuter((bridge.tx as any).data);
      expect(BigInt(info.l2GasLimit)).toBe(SAFE_NONBASE_L2_GAS_LIMIT);
    } else {
      const req = ((bridge.tx as any).args?.[0] ?? {}) as any;
      expect(BigInt(req.l2GasLimit ?? 0n)).toBe(SAFE_NONBASE_L2_GAS_LIMIT);
    }
  });

  it('uses a safe L2 gas limit when estimation fails without an override', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness, {
      l2GasLimit: undefined,
      baseTokenL1: BASE_TOKEN,
      baseIsEth: false,
      resolvedToken: makeResolvedEthToken(),
    });
    const amount = 3_500n;
    const baseCost = 10_000n;
    const mintValue = baseCost + ctx.operatorTip;

    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: SAFE_NONBASE_L2_GAS_LIMIT });
    setErc20Allowance(harness, BASE_TOKEN, ctx.sender, ctx.l1AssetRouter, mintValue);

    if (kind === 'ethers') {
      harness.setL2EstimateGas(new Error('no gas'));
    } else {
      harness.setEstimateGas(new Error('no gas'), 'l2');
    }

    const res = await ROUTES[kind].build(
      { token: FORMAL_ETH_ADDRESS, amount, to: RECEIVER } as any,
      ctx as any,
    );

    expect(res.approvals.length).toBe(0);
    expect(res.fees?.l2.baseCost).toBe(baseCost);
    expect(res.fees?.mintValue).toBe(mintValue);

    const bridge = res.steps.at(-1)!;
    if (kind === 'ethers') {
      const info = decodeTwoBridgeOuter((bridge.tx as any).data);
      expect(BigInt(info.l2GasLimit)).toBe(SAFE_NONBASE_L2_GAS_LIMIT);
    } else {
      const req = ((bridge.tx as any).args?.[0] ?? {}) as any;
      expect(BigInt(req.l2GasLimit ?? 0n)).toBe(SAFE_NONBASE_L2_GAS_LIMIT);
    }
  });

  if (kind === 'ethers') {
    it('falls back to the safe gas limit when bridge estimation fails', async () => {
      const harness = factory();
      const ctx = makeDepositContext(harness, {
        l2GasLimit: MIN_L2_GAS_FOR_ETH_NONBASE,
        baseTokenL1: BASE_TOKEN,
        baseIsEth: false,
        resolvedToken: makeResolvedEthToken(),
      });
      const amount = 2_000n;
      const baseCost = 3_000n;
      const mintValue = baseCost + ctx.operatorTip;

      setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: MIN_L2_GAS_FOR_ETH_NONBASE });
      setErc20Allowance(harness, BASE_TOKEN, ctx.sender, ctx.l1AssetRouter, mintValue);
      harness.setEstimateGas(new Error('no gas'));

      const res = await ROUTES.ethers.build(
        { token: FORMAL_ETH_ADDRESS, amount, to: RECEIVER } as any,
        ctx as any,
      );
      const bridgeTx = res.steps.at(-1)!.tx as any;
      expect(bridgeTx.gasLimit).toBe(SAFE_L1_BRIDGE_GAS);
    });
  }

  it('wraps base-token allowance failures as ZKsyncError', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness, {
      l2GasLimit: MIN_L2_GAS_FOR_ETH_NONBASE,
      baseTokenL1: BASE_TOKEN,
      baseIsEth: false,
      resolvedToken: makeResolvedEthToken(),
    });
    const amount = 1_000n;
    const baseCost = 2_000n;

    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: MIN_L2_GAS_FOR_ETH_NONBASE });

    let caught: unknown;
    try {
      await ROUTES[kind].build(
        { token: FORMAL_ETH_ADDRESS, amount, to: RECEIVER } as any,
        ctx as any,
      );
    } catch (err) {
      caught = err;
    }

    expect(isZKsyncError(caught)).toBe(true);
    expect(String(caught)).toMatch(/Failed to read base-token allowance/);
  });
});

describe('adapters/deposits/resource.create (ethers eth-nonbase)', () => {
  it('rechecks allowance using the router encoded in the approve step key', async () => {
    const harness = createEthersHarness();
    const tokens = makeEthNonBaseTokens(BASE_TOKEN);
    const deposits = createDepositsResource(harness.client, tokens);
    const ctx = makeDepositContext(harness, { l2GasLimit: MIN_L2_GAS_FOR_ETH_NONBASE });
    const amount = 5_000n;
    const baseCost = 4_000n;
    const mintValue = baseCost + ctx.operatorTip;
    const approveKey = `approve:${BASE_TOKEN}:${ctx.l1AssetRouter}`;
    const bridgeKey = 'bridgehub:two-bridges:eth-nonbase';
    const blockTags: string[] = [];
    const sent: Array<{ to?: string; nonce?: number }> = [];

    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: MIN_L2_GAS_FOR_ETH_NONBASE });
    setErc20Allowance(harness, BASE_TOKEN, ctx.sender, ctx.l1AssetRouter, mintValue - 1n);

    (harness.l1 as any).getBalance = async () => amount + 1n;
    (harness.l1 as any).getTransactionCount = async (_from: string, blockTag: string) => {
      blockTags.push(blockTag);
      return 12;
    };
    (harness.signer as any).populateTransaction = async (tx: any) => tx;
    (harness.signer as any).sendTransaction = async (tx: any) => {
      sent.push({ to: tx.to, nonce: tx.nonce });
      const hash = `0x${sent.length.toString(16).padStart(64, '0')}`;
      return {
        hash,
        wait: async () => ({ status: 1 }),
      };
    };

    const handle = await deposits.create({
      token: FORMAL_ETH_ADDRESS,
      amount,
      to: RECEIVER,
      l2GasLimit: MIN_L2_GAS_FOR_ETH_NONBASE,
      operatorTip: ctx.operatorTip,
    });

    expect(blockTags).toEqual(['latest', 'pending']);
    expect(sent.length).toBe(2);
    expect((sent[0].to as string).toLowerCase()).toBe(BASE_TOKEN.toLowerCase());
    expect(sent[0].nonce).toBe(12);
    expect(sent[1].nonce).toBe(13);
    expect(handle.stepHashes[approveKey]).toBe(`0x${'1'.padStart(64, '0')}`);
    expect(handle.stepHashes[bridgeKey]).toBe(`0x${'2'.padStart(64, '0')}`);
    expect(handle.l1TxHash).toBe(handle.stepHashes[bridgeKey]);
  });
});
