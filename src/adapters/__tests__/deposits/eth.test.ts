import { describe, it, expect } from 'bun:test';

import { routeEthDirect as routeEthers } from '../../ethers/resources/deposits/routes/eth.ts';
import { routeEthDirect as routeViem } from '../../viem/resources/deposits/routes/eth.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  makeDepositContext,
  setBridgehubBaseCost,
  describeForAdapters,
  setChainPricing,
} from '../adapter-harness.ts';
import {
  applyL1ToL2Alias,
  applyPriorityL2GasLimitBuffer,
  minimalPriorityTxL2Gas,
} from '../../../core/resources/deposits/priority.ts';
import { applyGasBuffer } from '../../../core/resources/deposits/gas.ts';
import { ZKSYNC_OS_PRIORITY_TX_TYPE } from '../../../core/constants.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';
import { parseDirectBridgeTx } from '../decode-helpers.ts';

type AdapterKind = 'ethers' | 'viem';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

describeForAdapters('adapters/deposits/routeEthDirect', (kind, factory) => {
  it('computes mintValue, encodes direct call, and produces a single plan step', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 1_234n;
    const baseCost = 2_000n;
    setBridgehubBaseCost(harness, ctx, baseCost);
    harness.setEstimateGas(200_000n);

    const res = await ROUTES[kind].build({ amount } as any, ctx as any);
    expect(res.approvals.length).toBe(0);
    expect(res.steps.length).toBe(1);

    const expectedMint = baseCost + ctx.operatorTip + amount;
    expect(res.fees?.l2.baseCost).toBe(baseCost);
    expect(res.fees?.mintValue).toBe(expectedMint);

    const step = res.steps[0];
    expect(step.key).toBe('bridgehub:direct');
    expect(step.kind).toBe('bridgehub:direct');

    const info = parseDirectBridgeTx(kind, step.tx);
    expect(info.to).toBe(ADAPTER_TEST_ADDRESSES.bridgehub.toLowerCase());
    expect(info.from).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());
    expect(info.value).toBe(expectedMint);
    expect(info.mintValue).toBe(expectedMint);
    expect(info.l2Contract).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());
    expect(info.l2Value).toBe(amount);
    expect(info.l2GasLimit).toBe(ctx.l2GasLimit);
    expect(info.refundRecipient).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());

    expect(info.gasLimit).toBe((200_000n * 120n) / 100n);
  });

  it('uses payload.to as the target L2 contract when provided', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 5_000n;
    const baseCost = 1_000n;
    const target = '0x2222222222222222222222222222222222222222';
    setBridgehubBaseCost(harness, ctx, baseCost);
    harness.setEstimateGas(120_000n);

    const res = await ROUTES[kind].build({ amount, to: target } as any, ctx as any);
    const info = parseDirectBridgeTx(kind, res.steps[0].tx);

    expect(info.l2Contract).toBe(target.toLowerCase());
    expect(info.l2Value).toBe(amount);
    const expectedMint = baseCost + ctx.operatorTip + amount;
    expect(res.fees?.mintValue).toBe(expectedMint);
  });

  it('uses a buffered priority-floor gas limit on EraVM when no explicit l2GasLimit is provided', async () => {
    const harness = factory();
    // A low node estimate leaves the priority floor in charge.
    harness.setPriorityEstimateGas(1n);
    const ctx = makeDepositContext(harness, { l2GasLimit: undefined });
    const amount = 1_234n;
    const baseCost = 2_000n;
    const rawPriorityFloorGasLimit = 253_884n;
    const expectedL2GasLimit = applyPriorityL2GasLimitBuffer({
      chainIdL2: ctx.chainIdL2,
      gasLimit: rawPriorityFloorGasLimit,
    });

    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: expectedL2GasLimit });
    harness.setEstimateGas(200_000n);

    const res = await ROUTES[kind].build({ amount } as any, ctx as any);
    const info = parseDirectBridgeTx(kind, res.steps[0].tx);

    expect(info.l2GasLimit).toBe(expectedL2GasLimit);
    expect(res.fees?.l2.gasLimit).toBe(expectedL2GasLimit);
  });

  it('applies a 40% priority gas buffer on non-EraVM chains when no explicit l2GasLimit is provided', async () => {
    const harness = factory();
    // A low node estimate leaves the priority floor in charge.
    harness.setPriorityEstimateGas(1n);
    const ctx = makeDepositContext(harness, { chainIdL2: 325n, l2GasLimit: undefined });
    const amount = 1_234n;
    const baseCost = 2_000n;
    const rawPriorityFloorGasLimit = 253_884n;
    const expectedL2GasLimit = applyPriorityL2GasLimitBuffer({
      chainIdL2: ctx.chainIdL2,
      gasLimit: rawPriorityFloorGasLimit,
    });

    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: expectedL2GasLimit });
    harness.setEstimateGas(200_000n);
    if (harness.kind === 'ethers') {
      (harness.l2 as any).getNetwork = async () => ({ chainId: 325n });
    } else {
      (harness.l2 as any).getChainId = async () => 325n;
    }

    const res = await ROUTES[kind].build({ amount } as any, ctx as any);
    const info = parseDirectBridgeTx(kind, res.steps[0].tx);

    expect(info.l2GasLimit).toBe(expectedL2GasLimit);
    expect(res.fees?.l2.gasLimit).toBe(expectedL2GasLimit);
  });

  it('raises the priority-floor gas limit to the ZKsync OS minimum when the buffered floor is lower', async () => {
    const harness = factory();
    // A low node estimate leaves the priority floor in charge.
    harness.setPriorityEstimateGas(1n);
    const gasPerPubdata = 2_000n;
    const ctx = makeDepositContext(harness, {
      chainIdL2: 506n,
      l2GasLimit: undefined,
      gasPerPubdata,
    });
    const amount = 1_234n;
    const baseCost = 2_000n;
    const expectedL2GasLimit = minimalPriorityTxL2Gas({ calldataLength: 0n, gasPerPubdata });

    setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: expectedL2GasLimit });
    harness.setEstimateGas(200_000n);

    const res = await ROUTES[kind].build({ amount } as any, ctx as any);
    const info = parseDirectBridgeTx(kind, res.steps[0].tx);

    expect(info.l2GasLimit).toBe(expectedL2GasLimit);
    expect(res.fees?.l2.gasLimit).toBe(expectedL2GasLimit);
  });

  if (kind === 'ethers') {
    it('ignores estimateGas failures and leaves gasLimit unset', async () => {
      const harness = factory();
      const ctx = makeDepositContext(harness);
      const amount = 777n;
      const baseCost = 999n;
      setBridgehubBaseCost(harness, ctx, baseCost);
      harness.setEstimateGas(new Error('boom'));

      const res = await ROUTES.ethers.build({ amount } as any, ctx as any);
      const info = parseDirectBridgeTx('ethers', res.steps[0].tx);
      expect(info.gasLimit).toBeUndefined();
    });
  }

  it('quotes the base cost at the maxFeePerGas the L1 tx carries when only the tip is overridden', async () => {
    const harness = factory();
    // market fees are maxFeePerGas 5 / tip 1, so a 10 wei tip needs a 14 wei fee cap
    const ctx = makeDepositContext(harness, {
      gasOverrides: { maxPriorityFeePerGas: 10n },
      fee: { gasPriceForBaseCost: 14n },
    });
    const amount = 1_000n;
    const baseCost = 3_000n;
    setBridgehubBaseCost(harness, ctx, baseCost);
    // L1 estimation fails, the tx must still be capped at the price the base cost assumed
    harness.setEstimateGas(new Error('boom'));

    const res = await ROUTES[kind].build({ amount } as any, ctx as any);
    const tx = res.steps[0].tx as { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };

    expect(res.fees?.l2.baseCost).toBe(baseCost);
    expect(tx.maxFeePerGas).toBe(14n);
    expect(tx.maxPriorityFeePerGas).toBe(10n);
  });

  for (const tip of [undefined, 0n]) {
    for (const estimationFails of [false, true]) {
      it(`keeps a zero fee cap with ${tip == null ? 'an omitted' : 'a zero'} tip when gas estimation ${estimationFails ? 'fails' : 'succeeds'}`, async () => {
        const harness = factory();
        const ctx = makeDepositContext(harness, {
          gasOverrides: { maxFeePerGas: 0n, maxPriorityFeePerGas: tip },
          fee: { gasPriceForBaseCost: 0n },
        });
        const amount = 1_000n;
        const baseCost = 3_000n;
        setBridgehubBaseCost(harness, ctx, baseCost);
        harness.setEstimateGas(estimationFails ? new Error('no gas estimate') : 200_000n);

        const res = await ROUTES[kind].build({ amount } as any, ctx as any);
        const tx = res.steps[0].tx as {
          maxFeePerGas?: bigint;
          maxPriorityFeePerGas?: bigint;
        };

        expect(res.fees?.l2.baseCost).toBe(baseCost);
        expect(tx.maxFeePerGas).toBe(0n);
        expect(tx.maxPriorityFeePerGas).toBe(0n);
      });
    }
  }

  it('wraps base cost call failures as ZKsyncError', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 1_000n;

    let caught: unknown;
    try {
      await ROUTES[kind].build({ amount } as any, ctx as any);
    } catch (err) {
      caught = err;
    }
    expect(isZKsyncError(caught)).toBe(true);
    expect(String(caught)).toMatch(/l2BaseCost/);
  });

  describe('node priority-tx estimate', () => {
    const CONTRACT_CODE = '0x6080604052';
    // Default context: buffered validator floor at 800 gas per pubdata byte.
    const floorGasLimit = applyPriorityL2GasLimitBuffer({ chainIdL2: 324n, gasLimit: 253_884n });
    // 590 pubdata bytes at 800 gas per byte, plus the 20% gas buffer.
    const NEW_ACCOUNTS_FALLBACK_GAS_LIMIT = 566_400n;

    async function buildL2GasLimit(
      harness: ReturnType<typeof factory>,
      amount: bigint,
      expectedL2GasLimit: bigint,
    ) {
      const ctx = makeDepositContext(harness, { l2GasLimit: undefined });
      setBridgehubBaseCost(harness, ctx, 2_000n, { l2GasLimit: expectedL2GasLimit });
      harness.setEstimateGas(200_000n);
      const res = await ROUTES[kind].build({ amount } as any, ctx as any);
      return { ctx, info: parseDirectBridgeTx(kind, res.steps[0].tx) };
    }

    it('raises the L2 gas limit to the buffered estimate, simulated from the aliased contract sender', async () => {
      const harness = factory();
      const amount = 1_234n;
      const nodeEstimate = 400_000n;
      const expectedL2GasLimit = applyGasBuffer(nodeEstimate);
      harness.setL1Code(CONTRACT_CODE);
      harness.setPriorityEstimateGas(nodeEstimate);

      const { ctx, info } = await buildL2GasLimit(harness, amount, expectedL2GasLimit);

      expect(expectedL2GasLimit).toBeGreaterThan(floorGasLimit);
      expect(info.l2GasLimit).toBe(expectedL2GasLimit);
      const estimated = harness.lastPriorityEstimateTx() as Record<string, string>;
      expect(estimated.type).toBe(ZKSYNC_OS_PRIORITY_TX_TYPE);
      expect(estimated.from.toLowerCase()).toBe(applyL1ToL2Alias(ctx.sender).toLowerCase());
      expect(estimated.to.toLowerCase()).toBe(ctx.sender.toLowerCase());
      expect(BigInt(estimated.value)).toBe(amount);
    });

    it('simulates from the sender itself and keeps the floor when an EOA estimate is lower', async () => {
      const harness = factory();
      harness.setL1Code('0x');
      harness.setPriorityEstimateGas(100_000n);

      const { ctx, info } = await buildL2GasLimit(harness, 1_234n, floorGasLimit);

      expect(info.l2GasLimit).toBe(floorGasLimit);
      const estimated = harness.lastPriorityEstimateTx() as Record<string, string>;
      expect(estimated.from.toLowerCase()).toBe(ctx.sender.toLowerCase());
    });

    it('falls back to the new-account pubdata model on a rollup when the node cannot estimate', async () => {
      const harness = factory();
      setChainPricing(harness, 324n, { zksyncOS: true, pubdataPricingMode: 0 });
      harness.setPriorityEstimateGas(new Error('unsupported tx type'));

      const { info } = await buildL2GasLimit(harness, 1_234n, NEW_ACCOUNTS_FALLBACK_GAS_LIMIT);

      expect(info.l2GasLimit).toBe(NEW_ACCOUNTS_FALLBACK_GAS_LIMIT);
    });

    it('takes the cautious rollup fallback when the chain pricing cannot be read from L1', async () => {
      const harness = factory();
      harness.setPriorityEstimateGas(new Error('unsupported tx type'));

      const { info } = await buildL2GasLimit(harness, 1_234n, NEW_ACCOUNTS_FALLBACK_GAS_LIMIT);

      expect(info.l2GasLimit).toBe(NEW_ACCOUNTS_FALLBACK_GAS_LIMIT);
    });

    it('keeps the floor on a validium when the node cannot estimate', async () => {
      const harness = factory();
      setChainPricing(harness, 324n, { zksyncOS: true, pubdataPricingMode: 1 });
      harness.setPriorityEstimateGas(new Error('unsupported tx type'));

      const { info } = await buildL2GasLimit(harness, 1_234n, floorGasLimit);

      expect(info.l2GasLimit).toBe(floorGasLimit);
    });

    it('uses the floor on an EraVM chain without asking the node', async () => {
      const harness = factory();
      setChainPricing(harness, 324n, { zksyncOS: false, pubdataPricingMode: 0 });
      harness.setPriorityEstimateGas(900_000n);

      const { info } = await buildL2GasLimit(harness, 1_234n, floorGasLimit);

      expect(info.l2GasLimit).toBe(floorGasLimit);
      expect(harness.lastPriorityEstimateTx()).toBeUndefined();
    });

    it('uses an explicit l2GasLimit without asking the node', async () => {
      const harness = factory();
      const ctx = makeDepositContext(harness);
      harness.setPriorityEstimateGas(900_000n);
      setBridgehubBaseCost(harness, ctx, 2_000n);
      harness.setEstimateGas(200_000n);

      const res = await ROUTES[kind].build({ amount: 1_234n } as any, ctx as any);

      expect(parseDirectBridgeTx(kind, res.steps[0].tx).l2GasLimit).toBe(ctx.l2GasLimit);
      expect(harness.lastPriorityEstimateTx()).toBeUndefined();
    });
  });
});
