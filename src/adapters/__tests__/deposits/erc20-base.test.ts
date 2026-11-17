import { describe, it, expect } from 'bun:test';

import { routeErc20Base as routeEthers } from '../../ethers/resources/deposits/routes/erc20-base.ts';
import { routeErc20Base as routeViem } from '../../viem/resources/deposits/routes/erc20-base.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  makeDepositContext,
  setBridgehubBaseCost,
  setErc20Allowance,
  describeForAdapters,
  setChainPricing,
} from '../adapter-harness.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';
import { parseDirectBridgeTx, parseApproveTx } from '../decode-helpers.ts';
import { SAFE_L1_BRIDGE_GAS, ZKSYNC_OS_PRIORITY_TX_TYPE } from '../../../core/constants.ts';
import {
  applyL1ToL2Alias,
  applyPriorityL2GasLimitBuffer,
} from '../../../core/resources/deposits/priority.ts';
import { applyGasBuffer } from '../../../core/resources/deposits/gas.ts';

type AdapterKind = 'ethers' | 'viem';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

const noReturnApproveError = () =>
  Object.assign(new Error('The contract function "approve" returned no data ("0x").'), {
    name: 'ContractFunctionExecutionError',
  });

describeForAdapters('adapters/deposits/routeErc20Base', (kind, factory) => {
  it('skips approval when allowance covers mintValue and builds a zero-value bridge tx', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 1_000n;
    const baseCost = 2_000n;
    const expectedMint = baseCost + ctx.operatorTip + amount;

    setBridgehubBaseCost(harness, ctx, baseCost);
    setErc20Allowance(
      harness,
      ADAPTER_TEST_ADDRESSES.baseTokenFor324,
      ctx.sender,
      ctx.l1NativeTokenVault,
      expectedMint,
    );

    const payload = { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any;
    const res = await ROUTES[kind].build(payload, ctx as any);

    expect(res.approvals.length).toBe(0);
    expect(res.steps.length).toBe(1);
    expect(res.fees?.l2.baseCost).toBe(baseCost);
    expect(res.fees?.mintValue).toBe(expectedMint);

    const bridge = res.steps[0];
    expect(bridge.key).toBe('bridgehub:direct:erc20-base');
    const info = parseDirectBridgeTx(kind, bridge.tx);
    expect(info.to).toBe(ADAPTER_TEST_ADDRESSES.bridgehub.toLowerCase());
    expect(info.from).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());
    expect(info.value).toBe(0n);
    expect(info.mintValue).toBe(expectedMint);
    expect(info.l2Value).toBe(amount);
    expect(info.l2Contract).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());

    if (kind === 'ethers') {
      expect(info.gasLimit).toBe((100_000n * 120n) / 100n);
    }
  });

  it('adds approval when allowance is insufficient and encodes approve step correctly', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 5_000n;
    const baseCost = 4_000n;
    const expectedMint = baseCost + ctx.operatorTip + amount;

    setBridgehubBaseCost(harness, ctx, baseCost);
    setErc20Allowance(
      harness,
      ADAPTER_TEST_ADDRESSES.baseTokenFor324,
      ctx.sender,
      ctx.l1NativeTokenVault,
      expectedMint - 1n,
    );

    const payload = { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any;
    const res = await ROUTES[kind].build(payload, ctx as any);

    expect(res.approvals.length).toBe(1);
    const [approval] = res.approvals;
    expect(approval.token.toLowerCase()).toBe(ADAPTER_TEST_ADDRESSES.baseTokenFor324.toLowerCase());
    expect(approval.spender.toLowerCase()).toBe(ctx.l1NativeTokenVault.toLowerCase());
    expect(approval.amount).toBe(expectedMint);
    expect(res.fees?.mintValue).toBe(expectedMint);
    expect(res.steps.length).toBe(2);

    const approve = res.steps[0];
    expect(approve.kind).toBe('approve');
    const approveInfo = parseApproveTx(kind, approve.tx);
    expect(approveInfo.to).toBe(ADAPTER_TEST_ADDRESSES.baseTokenFor324.toLowerCase());
    expect(approveInfo.spender).toBe(ctx.l1NativeTokenVault.toLowerCase());
    expect(approveInfo.amount).toBe(expectedMint);

    const bridge = res.steps[1];
    expect(bridge.key).toBe('bridgehub:direct:erc20-base');
    const info = parseDirectBridgeTx(kind, bridge.tx);
    expect(info.value).toBe(0n);
    expect(info.mintValue).toBe(expectedMint);
    expect(info.l2Value).toBe(amount);
  });

  if (kind === 'viem') {
    it('builds an approval request when approve simulation returns no data', async () => {
      const harness = factory();
      const ctx = makeDepositContext(harness);
      const amount = 5_000n;
      const baseCost = 4_000n;
      const expectedMint = baseCost + ctx.operatorTip + amount;

      setBridgehubBaseCost(harness, ctx, baseCost);
      setErc20Allowance(
        harness,
        ADAPTER_TEST_ADDRESSES.baseTokenFor324,
        ctx.sender,
        ctx.l1NativeTokenVault,
        expectedMint - 1n,
      );
      harness.setSimulateError(noReturnApproveError());

      const res = await ROUTES.viem.build(
        { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any,
        ctx as any,
      );

      expect(res.approvals.length).toBe(1);
      expect(res.steps.length).toBe(2);

      const approveInfo = parseApproveTx('viem', res.steps[0].tx);
      expect(approveInfo.to).toBe(ADAPTER_TEST_ADDRESSES.baseTokenFor324.toLowerCase());
      expect(approveInfo.spender).toBe(ctx.l1NativeTokenVault.toLowerCase());
      expect(approveInfo.amount).toBe(expectedMint);
    });

    it('still wraps non no-return approve simulation failures', async () => {
      const harness = factory();
      const ctx = makeDepositContext(harness);
      const amount = 5_000n;
      const baseCost = 4_000n;
      const expectedMint = baseCost + ctx.operatorTip + amount;

      setBridgehubBaseCost(harness, ctx, baseCost);
      setErc20Allowance(
        harness,
        ADAPTER_TEST_ADDRESSES.baseTokenFor324,
        ctx.sender,
        ctx.l1NativeTokenVault,
        expectedMint - 1n,
      );
      harness.setSimulateError(new Error('execution reverted'));

      let caught: unknown;
      try {
        await ROUTES.viem.build(
          { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any,
          ctx as any,
        );
      } catch (err) {
        caught = err;
      }

      expect(isZKsyncError(caught)).toBe(true);
      expect(String(caught)).toMatch(/Failed to simulate ERC-20 approve/);
    });
  }

  if (kind === 'ethers') {
    it('ignores estimateGas failures and falls back to the safe gas limit', async () => {
      const harness = factory();
      const ctx = makeDepositContext(harness);
      const amount = 2_000n;
      const baseCost = 3_000n;
      const expectedMint = baseCost + ctx.operatorTip + amount;

      setBridgehubBaseCost(harness, ctx, baseCost);
      setErc20Allowance(
        harness,
        ADAPTER_TEST_ADDRESSES.baseTokenFor324,
        ctx.sender,
        ctx.l1NativeTokenVault,
        expectedMint,
      );
      harness.setEstimateGas(new Error('no gas'));

      const res = await ROUTES.ethers.build(
        { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any,
        ctx as any,
      );
      const info = parseDirectBridgeTx('ethers', res.steps[0].tx);
      expect(info.gasLimit).toBe(SAFE_L1_BRIDGE_GAS);
    });
  }

  it('wraps allowance failures as ZKsyncError', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    const amount = 1_000n;
    const baseCost = 2_500n;

    setBridgehubBaseCost(harness, ctx, baseCost);

    let caught: unknown;
    try {
      await ROUTES[kind].build(
        { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any,
        ctx as any,
      );
    } catch (err) {
      caught = err;
    }
    expect(isZKsyncError(caught)).toBe(true);
    expect(String(caught)).toMatch(/Failed to read base-token allowance/);
  });

  describe('node priority-tx estimate', () => {
    const CONTRACT_CODE = '0x6080604052';
    // Default context: buffered validator floor at 800 gas per pubdata byte. This is the
    // 355,437 limit that left an ERC-4337 sender's base-token deposit short of pubdata gas.
    const floorGasLimit = applyPriorityL2GasLimitBuffer({ chainIdL2: 324n, gasLimit: 253_884n });
    // 590 pubdata bytes at 800 gas per byte, plus the 20% gas buffer.
    const NEW_ACCOUNTS_FALLBACK_GAS_LIMIT = 566_400n;

    async function buildL2GasLimit(
      harness: ReturnType<typeof factory>,
      amount: bigint,
      expectedL2GasLimit: bigint,
    ) {
      const ctx = makeDepositContext(harness, { l2GasLimit: undefined });
      const baseCost = 2_000n;
      setBridgehubBaseCost(harness, ctx, baseCost, { l2GasLimit: expectedL2GasLimit });
      setErc20Allowance(
        harness,
        ADAPTER_TEST_ADDRESSES.baseTokenFor324,
        ctx.sender,
        ctx.l1NativeTokenVault,
        baseCost + ctx.operatorTip + amount,
      );
      const res = await ROUTES[kind].build(
        { token: ADAPTER_TEST_ADDRESSES.baseTokenFor324, amount } as any,
        ctx as any,
      );
      return { ctx, info: parseDirectBridgeTx(kind, res.steps[0].tx) };
    }

    it('raises the L2 gas limit to the buffered estimate, simulated from the aliased contract sender', async () => {
      const harness = factory();
      const amount = 1_000n;
      const nodeEstimate = 400_000n;
      const expectedL2GasLimit = applyGasBuffer(nodeEstimate);
      harness.setL1Code(CONTRACT_CODE);
      harness.setPriorityEstimateGas(nodeEstimate);

      const { ctx, info } = await buildL2GasLimit(harness, amount, expectedL2GasLimit);

      expect(floorGasLimit).toBe(355_437n);
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

      const { ctx, info } = await buildL2GasLimit(harness, 1_000n, floorGasLimit);

      expect(info.l2GasLimit).toBe(floorGasLimit);
      const estimated = harness.lastPriorityEstimateTx() as Record<string, string>;
      expect(estimated.from.toLowerCase()).toBe(ctx.sender.toLowerCase());
    });

    it('falls back to the new-account pubdata model on a rollup when the node cannot estimate', async () => {
      const harness = factory();
      setChainPricing(harness, 324n, { zksyncOS: true, pubdataPricingMode: 0 });
      harness.setPriorityEstimateGas(new Error('unsupported tx type'));

      const { info } = await buildL2GasLimit(harness, 1_000n, NEW_ACCOUNTS_FALLBACK_GAS_LIMIT);

      expect(info.l2GasLimit).toBe(NEW_ACCOUNTS_FALLBACK_GAS_LIMIT);
    });

    it('takes the cautious rollup fallback when the chain pricing cannot be read from L1', async () => {
      const harness = factory();
      harness.setPriorityEstimateGas(new Error('unsupported tx type'));

      const { info } = await buildL2GasLimit(harness, 1_000n, NEW_ACCOUNTS_FALLBACK_GAS_LIMIT);

      expect(info.l2GasLimit).toBe(NEW_ACCOUNTS_FALLBACK_GAS_LIMIT);
    });

    it('keeps the floor on a validium when the node cannot estimate', async () => {
      const harness = factory();
      setChainPricing(harness, 324n, { zksyncOS: true, pubdataPricingMode: 1 });
      harness.setPriorityEstimateGas(new Error('unsupported tx type'));

      const { info } = await buildL2GasLimit(harness, 1_000n, floorGasLimit);

      expect(info.l2GasLimit).toBe(floorGasLimit);
    });

    it('uses the floor on an EraVM chain without asking the node', async () => {
      const harness = factory();
      setChainPricing(harness, 324n, { zksyncOS: false, pubdataPricingMode: 0 });
      harness.setPriorityEstimateGas(900_000n);

      const { info } = await buildL2GasLimit(harness, 1_000n, floorGasLimit);

      expect(info.l2GasLimit).toBe(floorGasLimit);
      expect(harness.lastPriorityEstimateTx()).toBeUndefined();
    });
  });
});
