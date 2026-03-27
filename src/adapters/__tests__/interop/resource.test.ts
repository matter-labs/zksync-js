import { describe, it, expect } from 'bun:test';
import { Interface } from 'ethers';

import { createInteropResource as createEthersInteropResource } from '../../ethers/resources/interop/index.ts';
import { createInteropResource as createViemInteropResource } from '../../viem/resources/interop/index.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  describeForAdapters,
  setErc20Allowance,
  setL2TokenRegistration,
  setInteropProtocolFee,
} from '../adapter-harness.ts';
import { L2_INTEROP_CENTER_ADDRESS } from '../../../core/constants.ts';
import type { Address, Hex } from '../../../core/types/primitives.ts';

type AdapterKind = 'ethers' | 'viem';

const RESOURCES = {
  ethers: createEthersInteropResource,
  viem: createViemInteropResource,
} as const;

const RECIPIENT = '0x2222222222222222222222222222222222222222' as Address;
const TX_HASH = `0x${'aa'.repeat(32)}` as Hex;
const ERC20_TOKEN = '0x3333333333333333333333333333333333333333' as Address;
const ASSET_ID = `0x${'11'.repeat(32)}` as Hex;
const IChainTypeManager = new Interface([
  'function getSemverProtocolVersion() view returns (uint32,uint32,uint32)',
]);

function createResource(kind: AdapterKind, harness: any) {
  if (kind === 'viem' && typeof harness.client.account === 'string') {
    const normalized = {
      address: harness.client.account,
      type: 'json-rpc',
    } as const;
    harness.client.account = normalized;
    harness.l1Wallet.account = normalized;
    harness.l2Wallet.account = normalized;
  }

  return RESOURCES[kind](harness.client, {
    gwChain: harness.l2 as any,
  });
}

describeForAdapters('adapters/interop/resource', (kind, factory) => {
  it('status returns SENT when source receipt is not yet available', async () => {
    const harness = factory();
    const interop = createResource(kind, harness);

    (harness.l2 as any).getTransactionReceipt = async () => null;

    const status = await interop.status(harness.l2 as any, TX_HASH);
    expect(status.phase).toBe('SENT');
    expect(status.l2SrcTxHash).toBe(TX_HASH);
  });

  it('status returns SENT when source receipt lookup throws not-found error', async () => {
    const harness = factory();
    const interop = createResource(kind, harness);

    (harness.l2 as any).getTransactionReceipt = async () => {
      const err = new Error('transaction/receipt not found');
      if (kind === 'ethers') {
        (err as any).code = 'TRANSACTION_NOT_FOUND';
      } else {
        (err as any).name = 'TransactionReceiptNotFoundError';
      }
      throw err;
    };

    const status = await interop.status(harness.l2 as any, TX_HASH);
    expect(status.phase).toBe('SENT');
    expect(status.l2SrcTxHash).toBe(TX_HASH);
  });

  it('create fetches nonce from pending transaction count by default', async () => {
    const harness = factory();
    setInteropProtocolFee(harness, L2_INTEROP_CENTER_ADDRESS, 0n);
    const interop = createResource(kind, harness);

    let requestedBlockTag: string | undefined;
    if (kind === 'ethers') {
      (harness.l2 as any).getTransactionCount = async (_from: string, blockTag: string) => {
        requestedBlockTag = blockTag;
        return 7;
      };

      (harness.signer as any).sendTransaction = async () => ({
        hash: TX_HASH,
        wait: async () => ({ status: 1 }),
      });
    } else {
      (harness.l2 as any).getTransactionCount = async ({
        blockTag,
      }: {
        address: Address;
        blockTag: string;
      }) => {
        requestedBlockTag = blockTag;
        return 7;
      };

      (harness.l2Wallet as any).sendTransaction = async () => TX_HASH;
      (harness.l2 as any).waitForTransactionReceipt = async () => ({ status: 'success' });
    }

    const handle = await interop.create(harness.l2 as any, {
      actions: [{ type: 'sendNative', to: RECIPIENT, amount: 1n }],
    });

    expect(requestedBlockTag).toBe('pending');
    expect(handle.l2SrcTxHash).toBe(TX_HASH);
  });

  it('create fetches nonce using txOverrides block tag', async () => {
    const harness = factory();
    setInteropProtocolFee(harness, L2_INTEROP_CENTER_ADDRESS, 0n);
    const interop = createResource(kind, harness);

    let requestedBlockTag: string | undefined;
    if (kind === 'ethers') {
      (harness.l2 as any).getTransactionCount = async (_from: string, blockTag: string) => {
        requestedBlockTag = blockTag;
        return 7;
      };

      (harness.signer as any).sendTransaction = async () => ({
        hash: TX_HASH,
        wait: async () => ({ status: 1 }),
      });
    } else {
      (harness.l2 as any).getTransactionCount = async ({
        blockTag,
      }: {
        address: Address;
        blockTag: string;
      }) => {
        requestedBlockTag = blockTag;
        return 7;
      };

      (harness.l2Wallet as any).sendTransaction = async () => TX_HASH;
      (harness.l2 as any).waitForTransactionReceipt = async () => ({ status: 'success' });
    }

    const handle = await interop.create(harness.l2 as any, {
      actions: [{ type: 'sendNative', to: RECIPIENT, amount: 1n }],
      txOverrides: {
        nonce: 'latest',
        gasLimit: 200_000n,
        maxFeePerGas: 10n,
      },
    });

    expect(requestedBlockTag).toBe('latest');
    expect(handle.l2SrcTxHash).toBe(TX_HASH);
  });

  it('create uses numeric txOverrides nonce as starting nonce', async () => {
    const harness = factory();
    setInteropProtocolFee(harness, L2_INTEROP_CENTER_ADDRESS, 0n);
    const interop = createResource(kind, harness);

    const sender = ADAPTER_TEST_ADDRESSES.signer;
    const { l2NativeTokenVault } = await harness.client.ensureAddresses();
    setL2TokenRegistration(harness, l2NativeTokenVault, ERC20_TOKEN, ASSET_ID);
    setErc20Allowance(harness, ERC20_TOKEN, sender, l2NativeTokenVault, 0n);

    let txCountCalls = 0;
    if (kind === 'ethers') {
      (harness.l2 as any).getTransactionCount = async () => {
        txCountCalls += 1;
        return 999;
      };
    } else {
      (harness.l2 as any).getTransactionCount = async () => {
        txCountCalls += 1;
        return 999;
      };
    }

    const sentNonces: Array<number | undefined> = [];
    if (kind === 'ethers') {
      (harness.signer as any).sendTransaction = async (tx: { nonce?: number }) => {
        sentNonces.push(tx.nonce);
        return {
          hash: TX_HASH,
          wait: async () => ({ status: 1 }),
        };
      };
    } else {
      (harness.l2Wallet as any).sendTransaction = async (tx: { nonce?: number }) => {
        sentNonces.push(tx.nonce);
        return TX_HASH;
      };
      (harness.l2 as any).waitForTransactionReceipt = async () => ({ status: 'success' });
    }

    await interop.create(harness.l2 as any, {
      actions: [
        {
          type: 'sendErc20',
          token: ERC20_TOKEN,
          to: RECIPIENT,
          amount: 2n,
        },
      ],
      txOverrides: {
        nonce: 42,
        gasLimit: 200_000n,
        maxFeePerGas: 10n,
      },
    });

    expect(txCountCalls).toBe(0);
    expect(sentNonces).toEqual([42, 43, 44]);
  });

  it('create applies txOverrides gas/fee fields and skips extra gas estimation when gasLimit is provided', async () => {
    const harness = factory();
    setInteropProtocolFee(harness, L2_INTEROP_CENTER_ADDRESS, 0n);
    const interop = createResource(kind, harness);

    let requestedBlockTag: string | undefined;
    if (kind === 'ethers') {
      (harness.l2 as any).getTransactionCount = async (_from: string, blockTag: string) => {
        requestedBlockTag = blockTag;
        return 7;
      };
    } else {
      (harness.l2 as any).getTransactionCount = async ({
        blockTag,
      }: {
        address: Address;
        blockTag: string;
      }) => {
        requestedBlockTag = blockTag;
        return 7;
      };
    }

    let estimateCalls = 0;
    if (kind === 'ethers') {
      harness.onL2EstimateGas(() => {
        estimateCalls += 1;
      });
    } else {
      (harness.l2 as any).estimateGas = async () => {
        estimateCalls += 1;
        return 111_111n;
      };
    }

    let sent: Record<string, unknown> | undefined;
    if (kind === 'ethers') {
      (harness.signer as any).sendTransaction = async (tx: Record<string, unknown>) => {
        sent = tx;
        return {
          hash: TX_HASH,
          wait: async () => ({ status: 1 }),
        };
      };
    } else {
      (harness.l2Wallet as any).sendTransaction = async (tx: Record<string, unknown>) => {
        sent = tx;
        return TX_HASH;
      };
      (harness.l2 as any).waitForTransactionReceipt = async () => ({ status: 'success' });
    }

    const handle = await interop.create(harness.l2 as any, {
      actions: [{ type: 'sendNative', to: RECIPIENT, amount: 1n }],
      txOverrides: {
        gasLimit: 200_000n,
        maxFeePerGas: 10n,
        maxPriorityFeePerGas: 3n,
      },
    });

    expect(requestedBlockTag).toBe('pending');
    // One estimate call is expected from quoteStepsL2Fee during plan assembly.
    // With gasLimit override set, create() should not perform an additional estimate.
    expect(estimateCalls).toBe(1);

    if (kind === 'ethers') {
      expect(sent?.gasLimit).toBe(200_000n);
      expect(sent?.maxFeePerGas).toBe(10n);
      expect(sent?.maxPriorityFeePerGas).toBe(3n);
    } else {
      expect(sent?.gas).toBe(200_000n);
      expect(sent?.maxFeePerGas).toBe(10n);
      expect(sent?.maxPriorityFeePerGas).toBe(3n);
    }

    expect(handle.l2SrcTxHash).toBe(TX_HASH);
  });

  it('prepare fails when protocol minor version is below 31', async () => {
    const harness = factory();
    const interop = createResource(kind, harness);

    harness.registry.set(
      ADAPTER_TEST_ADDRESSES.chainTypeManager,
      IChainTypeManager,
      'getSemverProtocolVersion',
      [0n, 30n, 0n],
    );

    let caught: unknown;
    try {
      await interop.prepare(harness.l2 as any, {
        actions: [{ type: 'sendNative', to: RECIPIENT, amount: 1n }],
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/interop requires protocol version 31\.0\+/i);
  });
});
