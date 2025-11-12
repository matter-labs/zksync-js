import { describe, it, expect } from 'bun:test';
import { routeErc20NonBase as routeEthers } from '../../ethers/resources/deposits/routes/erc20-nonbase.ts';
import { routeErc20NonBase as routeViem } from '../../viem/resources/deposits/routes/erc20-nonbase.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  makeDepositContext,
  setBridgehubBaseCost,
  setBridgehubBaseToken,
  setErc20Allowance,
  describeForAdapters,
} from '../adapter-harness.ts';
import { FORMAL_ETH_ADDRESS } from '../../../core/constants.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';
import { decodeSecondBridgeErc20, decodeTwoBridgeOuter } from '../decode-helpers.ts';

type AdapterKind = 'ethers' | 'viem';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

const MIN_L2_GAS_FOR_ERC20 = 2_500_000n;

const ERC20_TOKEN = '0x3333333333333333333333333333333333333333' as const;
const BASE_TOKEN = ADAPTER_TEST_ADDRESSES.baseTokenFor324;
const RECEIVER = '0x4444444444444444444444444444444444444444' as const;

const withBuffer = (x: bigint) => (x * 10100n) / 10000n;

function expectedMint(kind: AdapterKind, baseCost: bigint, operatorTip: bigint) {
  const raw = baseCost + operatorTip;
  return kind === 'viem' ? withBuffer(raw) : raw;
}

describeForAdapters('adapters/deposits/routeErc20NonBase', (kind, factory) => {
  it('handles non-base ERC-20 where fees are paid in ETH (no approvals required)', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness, { l2GasLimit: 600_000n });
    const amount = 1_000n;
    const baseCost = 3_000n;
    const mintValue = expectedMint(kind, baseCost, ctx.operatorTip);

    setBridgehubBaseToken(harness, ctx, FORMAL_ETH_ADDRESS);
    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: MIN_L2_GAS_FOR_ERC20 });
    setErc20Allowance(harness, ERC20_TOKEN, ctx.sender, ctx.l1AssetRouter, amount);

    const res = await ROUTES[kind].build(
      { token: ERC20_TOKEN, amount, to: RECEIVER } as any,
      ctx as any,
    );

    expect(res.approvals.length).toBe(0);
    expect(res.steps.length).toBe(1);
    expect(res.quoteExtras.baseCost).toBe(baseCost);
    expect(res.quoteExtras.mintValue).toBe(mintValue);

    const step = res.steps[0];
    const tx = step.tx as any;
    if (kind === 'ethers') {
      const info = decodeTwoBridgeOuter(tx.data);
      const bridgeArgs = decodeSecondBridgeErc20(info.secondBridgeCalldata);

      expect(step.key).toBe('bridgehub:two-bridges:nonbase');
      expect((tx.to as string).toLowerCase()).toBe(ADAPTER_TEST_ADDRESSES.bridgehub.toLowerCase());
      expect((tx.from as string).toLowerCase()).toBe(ctx.sender.toLowerCase());
      expect(BigInt(tx.value ?? 0n)).toBe(mintValue);
      expect(BigInt(info.mintValue)).toBe(mintValue);
      expect(BigInt(info.l2GasLimit)).toBe(MIN_L2_GAS_FOR_ERC20);
      expect(bridgeArgs.token).toBe(ERC20_TOKEN.toLowerCase());
      expect(bridgeArgs.amount).toBe(amount);
      expect(bridgeArgs.receiver).toBe(RECEIVER.toLowerCase());
      expect(tx.gasLimit).toBe((100_000n * 125n) / 100n);
      expect(res.quoteExtras.baseToken.toLowerCase()).toBe(FORMAL_ETH_ADDRESS.toLowerCase());
      expect(res.quoteExtras.baseIsEth).toBe(true);
    } else {
      const infoArgs = (tx.args?.[0] ?? {}) as any;
      expect(step.key).toBe('bridgehub:two-bridges:nonbase');
      expect((tx.address as string).toLowerCase()).toBe(
        ADAPTER_TEST_ADDRESSES.bridgehub.toLowerCase(),
      );
      expect((tx.account as string).toLowerCase()).toBe(ctx.sender.toLowerCase());
      expect(BigInt(tx.value ?? 0n)).toBe(mintValue);
      expect(BigInt(infoArgs.mintValue ?? 0n)).toBe(mintValue);
      expect(BigInt(infoArgs.l2GasLimit ?? 0n)).toBe(MIN_L2_GAS_FOR_ERC20);
    }
  });

  it('requires approvals when deposit and base allowances are insufficient', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 5_000n;
    const baseCost = 4_000n;
    const mintValue = expectedMint(kind, baseCost, ctx.operatorTip);

    setBridgehubBaseToken(harness, ctx, BASE_TOKEN);
    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: MIN_L2_GAS_FOR_ERC20 });
    setErc20Allowance(harness, ERC20_TOKEN, ctx.sender, ctx.l1AssetRouter, amount - 1n);
    setErc20Allowance(harness, BASE_TOKEN, ctx.sender, ctx.l1AssetRouter, mintValue - 1n);

    const res = await ROUTES[kind].build(
      { token: ERC20_TOKEN, amount, to: RECEIVER } as any,
      ctx as any,
    );

    expect(res.approvals).toEqual([
      { token: ERC20_TOKEN, spender: ctx.l1AssetRouter, amount },
      { token: BASE_TOKEN, spender: ctx.l1AssetRouter, amount: mintValue },
    ]);
    expect(res.steps.length).toBe(3); // two approvals + bridge
    expect(res.quoteExtras.baseCost).toBe(baseCost);
    expect(res.quoteExtras.mintValue).toBe(mintValue);

    const [approveDeposit, approveBase, bridge] = res.steps;
    expect(approveDeposit.kind).toBe('approve');
    expect(approveBase.kind).toBe('approve');
    expect(bridge.key).toBe('bridgehub:two-bridges:nonbase');

    if (kind === 'ethers') {
      const txDep = approveDeposit.tx as any;
      const txBase = approveBase.tx as any;
      expect((txDep.to as string).toLowerCase()).toBe(ERC20_TOKEN.toLowerCase());
      expect((txBase.to as string).toLowerCase()).toBe(BASE_TOKEN.toLowerCase());

      const info = decodeTwoBridgeOuter((bridge.tx as any).data);
      expect(BigInt((bridge.tx as any).value ?? 0n)).toBe(0n);
      expect(BigInt(info.mintValue)).toBe(mintValue);
      expect(res.quoteExtras.baseToken.toLowerCase()).toBe(BASE_TOKEN.toLowerCase());
      expect(res.quoteExtras.baseIsEth).toBe(false);
    } else {
      const depArgs = (approveDeposit.tx as any).args as unknown[];
      const baseArgs = (approveBase.tx as any).args as unknown[];
      expect((approveDeposit.tx as any).address.toLowerCase()).toBe(ERC20_TOKEN.toLowerCase());
      expect((depArgs?.[0] as string).toLowerCase()).toBe(ctx.l1AssetRouter.toLowerCase());
      expect(BigInt(depArgs?.[1] as bigint)).toBe(amount);

      expect((approveBase.tx as any).address.toLowerCase()).toBe(BASE_TOKEN.toLowerCase());
      expect((baseArgs?.[0] as string).toLowerCase()).toBe(ctx.l1AssetRouter.toLowerCase());
      expect(BigInt(baseArgs?.[1] as bigint)).toBe(mintValue);

      const bridgeTx = bridge.tx as any;
      expect(BigInt(bridgeTx.value ?? 0n)).toBe(0n);
      expect(BigInt((bridgeTx.args?.[0] as any)?.mintValue ?? 0n)).toBe(mintValue);
    }
  });

  if (kind === 'ethers') {
    it('ignores estimateGas failures and leaves gasLimit undefined', async () => {
      const harness = factory();
      const ctx = makeDepositContext(harness);
      const amount = 2_000n;
      const baseCost = 3_000n;
      const mintValue = expectedMint('ethers', baseCost, ctx.operatorTip);

      setBridgehubBaseToken(harness, ctx, BASE_TOKEN);
      setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: MIN_L2_GAS_FOR_ERC20 });
      setErc20Allowance(harness, ERC20_TOKEN, ctx.sender, ctx.l1AssetRouter, amount);
      setErc20Allowance(harness, BASE_TOKEN, ctx.sender, ctx.l1AssetRouter, mintValue);
      harness.setEstimateGas(new Error('no gas'));

      const res = await ROUTES.ethers.build({ token: ERC20_TOKEN, amount } as any, ctx as any);
      const bridgeTx = res.steps.at(-1)!.tx as any;
      expect(bridgeTx.gasLimit).toBeUndefined();
    });
  }

  it('wraps allowance read failures as ZKsyncError', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 1_000n;
    const baseCost = 2_000n;

    setBridgehubBaseToken(harness, ctx, BASE_TOKEN);
    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: MIN_L2_GAS_FOR_ERC20 });

    let caught: unknown;
    try {
      await ROUTES[kind].build({ token: ERC20_TOKEN, amount } as any, ctx as any);
    } catch (err) {
      caught = err;
    }
    expect(isZKsyncError(caught)).toBe(true);
    expect(String(caught)).toMatch(/Failed to read (?:deposit-token|base-token|ERC-20) allowance/);
  });
});
