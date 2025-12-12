import { describe, it, expect } from 'bun:test';

import { routeErc20NonBase as routeEthers } from '../../ethers/resources/withdrawals/routes/erc20-nonbase.ts';
import { routeErc20NonBase as routeViem } from '../../viem/resources/withdrawals/routes/erc20-nonbase.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  makeWithdrawalContext,
  setErc20Allowance,
  setL2TokenRegistration,
  describeForAdapters,
} from '../adapter-harness.ts';
import { L2NativeTokenVaultABI, IL2AssetRouterABI } from '../../../core/abi.ts';
import { isZKsyncError } from '../../../core/types/errors.ts';
import { decodeAssetRouterWithdraw } from '../decode-helpers.ts';
import { L2_ASSET_ROUTER_ADDRESS, L2_NATIVE_TOKEN_VAULT_ADDRESS } from '../../../core/constants.ts';

type AdapterKind = 'ethers' | 'viem';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

const TOKEN = '0x6666666666666666666666666666666666666666' as const;
const RECEIVER = '0x7777777777777777777777777777777777777777' as const;
const ASSET_ID = ('0x' + 'aa'.repeat(32)) as `0x${string}`;

const L2_NATIVE_VAULT = L2_NATIVE_TOKEN_VAULT_ADDRESS;

describeForAdapters('adapters/withdrawals/routeErc20NonBase', (kind, factory) => {
  it('builds withdraw plan without approvals when allowance sufficient', async () => {
    const harness = factory();
    const ctx = makeWithdrawalContext(harness, {
      l2NativeTokenVault: L2_NATIVE_VAULT,
      l2AssetRouter: L2_ASSET_ROUTER_ADDRESS,
    });
    const amount = 5_000n;

    setErc20Allowance(harness, TOKEN, ctx.sender, ctx.l2NativeTokenVault, amount);
    setL2TokenRegistration(harness, ctx.l2NativeTokenVault, TOKEN, ASSET_ID);

    if (kind === 'viem') {
      harness.queueSimulateResponses(
        [
          (args) => ({
            request: {
              address: args.address,
              abi: L2NativeTokenVaultABI,
              functionName: 'ensureTokenIsRegistered',
              args: args.args,
              account: args.account,
            },
            result: ASSET_ID,
          }),
          (args) => ({
            request: {
              address: args.address,
              abi: IL2AssetRouterABI,
              functionName: 'withdraw',
              args: args.args,
              account: args.account,
            },
          }),
        ],
        'l2',
      );
    }

    const res = await ROUTES[kind].build({ token: TOKEN, amount, to: RECEIVER } as any, ctx as any);
    expect(res.approvals.length).toBe(0);
    expect(res.steps.length).toBe(1);

    const step = res.steps[0];
    expect(step.key).toBe('l2-asset-router:withdraw');

    if (kind === 'ethers') {
      const tx = step.tx as any;
      const decoded = decodeAssetRouterWithdraw(tx.data);
      expect(decoded.assetId).toBe(ASSET_ID);
      expect(decoded.amount).toBe(amount);
      expect(decoded.receiver).toBe(RECEIVER.toLowerCase());
      expect(decoded.token).toBe(TOKEN.toLowerCase());
    } else {
      const tx = step.tx as any;
      const args = tx.args as unknown[];
      expect(args?.[0] ?? '').toBe(ASSET_ID);
    }
  });

  it('adds approval when allowance insufficient', async () => {
    const harness = factory();
    const ctx = makeWithdrawalContext(harness, {
      l2NativeTokenVault: L2_NATIVE_VAULT,
      l2AssetRouter: L2_ASSET_ROUTER_ADDRESS,
    });
    const amount = 999n;

    setErc20Allowance(harness, TOKEN, ctx.sender, ctx.l2NativeTokenVault, 100n);
    setL2TokenRegistration(harness, ctx.l2NativeTokenVault, TOKEN, ASSET_ID);

    if (kind === 'viem') {
      harness.queueSimulateResponses(
        [
          (args) => ({
            request: {
              address: args.address,
              abi: L2NativeTokenVaultABI,
              functionName: 'ensureTokenIsRegistered',
              args: args.args,
              account: args.account,
            },
            result: ASSET_ID,
          }),
        ],
        'l2',
      );
    }

    const res = await ROUTES[kind].build({ token: TOKEN, amount } as any, ctx as any);
    expect(res.approvals).toEqual([{ token: TOKEN, spender: ctx.l2NativeTokenVault, amount }]);
    expect(res.steps[0].kind).toBe('approve:l2');
    expect(res.steps.at(-1)?.key).toBe('l2-asset-router:withdraw');
  });

  it('wraps allowance failures as ZKsyncError', async () => {
    const harness = factory();
    const ctx = makeWithdrawalContext(harness, {
      l2NativeTokenVault: L2_NATIVE_VAULT,
      l2AssetRouter: L2_ASSET_ROUTER_ADDRESS,
    });

    setL2TokenRegistration(harness, ctx.l2NativeTokenVault, TOKEN, ASSET_ID);

    if (kind === 'viem') {
      harness.setSimulateResponse(
        (args) => ({
          request: {
            address: args.address,
            abi: L2NativeTokenVaultABI,
            functionName: 'ensureTokenIsRegistered',
            args: args.args,
            account: args.account,
          },
          result: ASSET_ID,
        }),
        'l2',
      );
    }

    let caught: unknown;
    try {
      await ROUTES[kind].build({ token: TOKEN, amount: 1n } as any, ctx as any);
    } catch (err) {
      caught = err;
    }
    expect(isZKsyncError(caught)).toBe(true);
    expect(String(caught)).toMatch(/Failed to read L2 ERC-20 allowance/);
  });
});
