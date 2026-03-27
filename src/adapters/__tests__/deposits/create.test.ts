import { describe, expect, it } from 'bun:test';

import { createDepositsResource as createEthersDepositsResource } from '../../ethers/resources/deposits/index.ts';
import { createDepositsResource as createViemDepositsResource } from '../../viem/resources/deposits/index.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  createAdapterHarness,
  makeDepositContext,
  setBridgehubBaseCost,
  type AdapterHarness,
} from '../adapter-harness.ts';
import { ETH_ADDRESS, FORMAL_ETH_ADDRESS } from '../../../core/constants.ts';
import type { Address, Hex } from '../../../core/types/primitives.ts';
import type { ResolvedToken, TokensResource } from '../../../core/types/flows/token.ts';

const ETH_BASE_TOKEN_ASSET_ID = `0x${'11'.repeat(32)}` as Hex;
const ETH_ASSET_ID = `0x${'22'.repeat(32)}` as Hex;
const WETH_L1 = '0x5555555555555555555555555555555555555555' as Address;
const WETH_L2 = '0x6666666666666666666666666666666666666666' as Address;

function makeResolvedEthBaseToken(): ResolvedToken {
  return {
    kind: 'eth',
    l1: FORMAL_ETH_ADDRESS,
    l2: ETH_ADDRESS,
    assetId: ETH_ASSET_ID,
    originChainId: 1n,
    isChainEthBased: true,
    baseTokenAssetId: ETH_BASE_TOKEN_ASSET_ID,
    wethL1: WETH_L1,
    wethL2: WETH_L2,
  };
}

function makeEthBaseTokens(): TokensResource {
  const resolved = makeResolvedEthBaseToken();
  return {
    async resolve() {
      return resolved;
    },
    async l1TokenFromAssetId() {
      return FORMAL_ETH_ADDRESS;
    },
  } as TokensResource;
}

function createDepositsResource(harness: AdapterHarness, tokens: TokensResource) {
  if (harness.kind === 'viem') {
    (harness.client as any).account = { address: ADAPTER_TEST_ADDRESSES.signer };
  }

  return harness.kind === 'ethers'
    ? createEthersDepositsResource(harness.client, tokens)
    : createViemDepositsResource(harness.client, tokens);
}

function installCreateStubs(harness: AdapterHarness, sentGas: bigint[]) {
  if (harness.kind === 'ethers') {
    (harness.l1 as any).getTransactionCount = async () => 12;
    (harness.signer as any).populateTransaction = async (tx: any) => tx;
    (harness.signer as any).sendTransaction = async (tx: any) => {
      sentGas.push(BigInt(tx.gasLimit ?? 0n));
      return {
        hash: `0x${'1'.padStart(64, '0')}`,
        wait: async () => ({ status: 1 }),
      };
    };
    return;
  }

  (harness.l1 as any).getTransactionCount = async () => 12;
  (harness.l1Wallet as any).writeContract = async (tx: any) => {
    sentGas.push(BigInt(tx.gas ?? 0n));
    return `0x${'1'.padStart(64, '0')}`;
  };
  (harness.l1 as any).waitForTransactionReceipt = async () => ({ status: 'success' });
}

function overrideL2ChainId(harness: AdapterHarness, chainId: bigint) {
  if (harness.kind === 'ethers') {
    (harness.l2 as any).getNetwork = async () => ({ chainId });
    return;
  }

  (harness.l2 as any).getChainId = async () => chainId;
}

describe('adapters/deposits/resource.create direct eth', () => {
  for (const kind of ['ethers', 'viem'] as const) {
    it(`${kind} keeps the prepared bridge gas floor on EraVM chains`, async () => {
      const harness = createAdapterHarness(kind);
      const deposits = createDepositsResource(harness, makeEthBaseTokens());
      const ctx = makeDepositContext(harness, { l2GasLimit: 600_000n });
      const sentGas: bigint[] = [];

      setBridgehubBaseCost(harness, ctx, 4_000n);
      harness.queueEstimateGas([200_000n, 100_000n]);
      installCreateStubs(harness, sentGas);

      await deposits.create({
        token: FORMAL_ETH_ADDRESS,
        amount: 1_000n,
        l2GasLimit: 600_000n,
        operatorTip: ctx.operatorTip,
      });

      expect(sentGas).toEqual([240_000n]);
    });

    it(`${kind} uses the 20% buffer on EraVM chains when prepare has no bridge gas`, async () => {
      const harness = createAdapterHarness(kind);
      const deposits = createDepositsResource(harness, makeEthBaseTokens());
      const ctx = makeDepositContext(harness, { l2GasLimit: 600_000n });
      const sentGas: bigint[] = [];

      setBridgehubBaseCost(harness, ctx, 4_000n);
      harness.queueEstimateGas([new Error('no gas'), 100_000n]);
      installCreateStubs(harness, sentGas);

      await deposits.create({
        token: FORMAL_ETH_ADDRESS,
        amount: 1_000n,
        l2GasLimit: 600_000n,
        operatorTip: ctx.operatorTip,
      });

      expect(sentGas).toEqual([120_000n]);
    });

    it(`${kind} keeps the 15% create-time buffer on non-EraVM chains`, async () => {
      const harness = createAdapterHarness(kind);
      overrideL2ChainId(harness, 325n);

      const deposits = createDepositsResource(harness, makeEthBaseTokens());
      const ctx = makeDepositContext(harness, { chainIdL2: 325n, l2GasLimit: 600_000n });
      const sentGas: bigint[] = [];

      setBridgehubBaseCost(harness, ctx, 4_000n);
      harness.queueEstimateGas([200_000n, 100_000n]);
      installCreateStubs(harness, sentGas);

      await deposits.create({
        token: FORMAL_ETH_ADDRESS,
        amount: 1_000n,
        l2GasLimit: 600_000n,
        operatorTip: ctx.operatorTip,
      });

      expect(sentGas).toEqual([115_000n]);
    });
  }
});
