import { describe, it, expect } from 'bun:test';
import { Interface } from 'ethers';

import { createWithdrawalsResource as createEthersWithdrawals } from '../../ethers/resources/withdrawals/index.ts';
import { createWithdrawalsResource as createViemWithdrawals } from '../../viem/resources/withdrawals/index.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  createAdapterHarness,
  recordContractReads,
  setErc20Allowance,
  setL2TokenRegistration,
  type AdapterHarness,
} from '../adapter-harness.ts';
import {
  L1NativeTokenVaultABI,
  L2NativeTokenVaultABI,
  IL2AssetRouterABI,
} from '../../../core/abi.ts';
import {
  L2_ASSET_ROUTER_ADDRESS,
  L2_BASE_TOKEN_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
} from '../../../core/constants.ts';

const L1NTV = new Interface(L1NativeTokenVaultABI as any);
const L2NTV = new Interface(L2NativeTokenVaultABI as any);

const L1_TOKEN = '0x0000000000000000000000000000000000000111' as const;
const L2_TOKEN = '0x0000000000000000000000000000000000000222' as const;
const RECEIVER = '0x7777777777777777777777777777777777777777' as const;
const ASSET_ID = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const BASE_TOKEN_ASSET_ID = ('0x' + 'bb'.repeat(32)) as `0x${string}`;
const AMOUNT = 10_000_000n;

// The removed v33 `L2AssetRouter.l1TokenAddress(address)` selector.
const L1_TOKEN_ADDRESS_SELECTOR = '0xf54266a2';

function seedBridgedErc20(harness: AdapterHarness) {
  const l1Ntv = ADAPTER_TEST_ADDRESSES.l1NativeTokenVault;
  harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'assetId', ASSET_ID, [L2_TOKEN]);
  harness.registry.set(l1Ntv, L1NTV, 'tokenAddress', L1_TOKEN, [ASSET_ID]);
  harness.registry.set(l1Ntv, L1NTV, 'assetId', ASSET_ID, [L1_TOKEN]);
  harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'originChainId', 1n, [ASSET_ID]);
  harness.registry.set(
    L2_NATIVE_TOKEN_VAULT_ADDRESS,
    L2NTV,
    'BASE_TOKEN_ASSET_ID',
    BASE_TOKEN_ASSET_ID,
  );
  harness.registry.set(l1Ntv, L1NTV, 'tokenAddress', ADAPTER_TEST_ADDRESSES.baseTokenFor324, [
    BASE_TOKEN_ASSET_ID,
  ]);
  harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'L1_CHAIN_ID', 1n);
  harness.registry.set(l1Ntv, L1NTV, 'WETH_TOKEN', ADAPTER_TEST_ADDRESSES.baseTokenFor324);
  harness.registry.set(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NTV, 'WETH_TOKEN', L2_BASE_TOKEN_ADDRESS);
}

function createWithdrawals(harness: AdapterHarness) {
  if (harness.kind === 'viem') {
    (harness.client as any).account = { address: ADAPTER_TEST_ADDRESSES.signer };
    harness.queueSimulateResponses(
      [
        (args: any) => ({
          request: {
            address: args.address,
            abi: L2NativeTokenVaultABI,
            functionName: 'ensureTokenIsRegistered',
            args: args.args,
            account: args.account,
          },
          result: ASSET_ID,
        }),
        (args: any) => ({
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
    return createViemWithdrawals(harness.client);
  }
  return createEthersWithdrawals(harness.client);
}

describe('adapters/withdrawals ERC-20 token resolution', () => {
  for (const kind of ['ethers', 'viem'] as const) {
    it(`${kind} quotes an L2 ERC-20 withdrawal without calling L2AssetRouter.l1TokenAddress`, async () => {
      const harness = createAdapterHarness(kind);
      const reads = recordContractReads(harness);
      seedBridgedErc20(harness);
      setErc20Allowance(
        harness,
        L2_TOKEN,
        ADAPTER_TEST_ADDRESSES.signer,
        L2_NATIVE_TOKEN_VAULT_ADDRESS,
        AMOUNT,
      );
      setL2TokenRegistration(harness, L2_NATIVE_TOKEN_VAULT_ADDRESS, L2_TOKEN, ASSET_ID);

      const withdrawals = createWithdrawals(harness);
      const quote = await withdrawals.quote({ token: L2_TOKEN, amount: AMOUNT, to: RECEIVER });

      expect(quote.route).toBe('erc20-nonbase');
      expect(quote.approvalsNeeded.length).toBe(0);

      const assetRouterReads = reads.filter(
        (r) => r.address === L2_ASSET_ROUTER_ADDRESS.toLowerCase(),
      );
      expect(assetRouterReads).toEqual([]);
      expect(
        reads.some((r) => r.selector === L1_TOKEN_ADDRESS_SELECTOR || r.fn === 'l1TokenAddress'),
      ).toBe(false);
      expect(
        reads.some(
          (r) => r.address === L2_NATIVE_TOKEN_VAULT_ADDRESS.toLowerCase() && r.fn === 'assetId',
        ),
      ).toBe(true);
    });
  }
});
