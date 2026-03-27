import { describe, it, expect } from 'bun:test';
import { Interface } from 'ethers';

import { createInteropResource as createEthersInteropResource } from '../../ethers/resources/interop/index.ts';
import { createInteropResource as createViemInteropResource } from '../../viem/resources/interop/index.ts';
import { describeForAdapters, ADAPTER_TEST_ADDRESSES } from '../adapter-harness.ts';
import { L2_INTEROP_ROOT_STORAGE_ADDRESS } from '../../../core/constants.ts';
import { IInteropRootStorageABI } from '../../../core/abi.ts';
import type { Hex } from '../../../core/types/primitives.ts';
import type { InteropFinalizationInfo } from '../../../core/types/flows/interop.ts';

type AdapterKind = 'ethers' | 'viem';

const RESOURCES = {
  ethers: createEthersInteropResource,
  viem: createViemInteropResource,
} as const;

const BUNDLE_HASH = `0x${'cc'.repeat(32)}` as Hex;
const ENCODED_DATA = `0x${'dd'.repeat(64)}` as Hex;
const SRC_TX_HASH = `0x${'aa'.repeat(32)}` as Hex;
const VERIFY_TX_HASH = `0x${'bb'.repeat(32)}` as Hex;
const INTEROP_ROOT = `0x${'ee'.repeat(32)}` as Hex;

const ROOT_CHAIN_ID = 324n;
const BATCH_NUMBER = 5n;

const FINALIZATION_INFO: InteropFinalizationInfo = {
  l2SrcTxHash: SRC_TX_HASH,
  bundleHash: BUNDLE_HASH,
  dstChainId: 325n,
  encodedData: ENCODED_DATA,
  proof: {
    chainId: 324n,
    l1BatchNumber: 1n,
    l2MessageIndex: 0n,
    message: {
      txNumberInBatch: 0,
      sender: ADAPTER_TEST_ADDRESSES.signer,
      data: '0x' as Hex,
    },
    proof: [] as Hex[],
  },
};

const IInteropRootStorage = new Interface(IInteropRootStorageABI as any);

function createResource(kind: AdapterKind, harness: any) {
  if (kind === 'viem' && typeof harness.client.account === 'string') {
    const normalized = { address: harness.client.account, type: 'json-rpc' } as const;
    harness.client.account = normalized;
    harness.l1Wallet.account = normalized;
    harness.l2Wallet.account = normalized;
  }

  return RESOURCES[kind](harness.client, { gwChain: harness.l2 as any });
}

/** Patches the viem dstProvider's transport so writeContract can send a transaction. */
function mockViemTransport(dstProvider: any, txHash: Hex, status: 'success' | 'reverted' = 'success') {
  dstProvider.transport = {
    type: 'mock',
    value: {},
    request: async ({ method }: { method: string }) => {
      switch (method) {
        case 'eth_chainId': return '0x144';
        case 'eth_getTransactionCount': return '0x0';
        case 'eth_estimateGas': return '0x186A0';
        case 'eth_gasPrice': return '0x1';
        case 'eth_maxPriorityFeePerGas': return '0x1';
        case 'eth_feeHistory':
          return { baseFeePerGas: ['0x1', '0x1'], gasUsedRatio: [0.5], reward: [['0x1']] };
        case 'eth_sendTransaction':
        case 'eth_sendRawTransaction':
          return txHash;
        default:
          throw new Error(`viem mock transport: unhandled method ${method}`);
      }
    },
  };
  dstProvider.waitForTransactionReceipt = async () => ({ status });
}

// ---------------------------------------------------------------------------
// getInteropRoot
// ---------------------------------------------------------------------------

describeForAdapters('adapters/interop/getInteropRoot', (kind, factory) => {
  it('returns the interop root from the destination chain', async () => {
    const harness = factory();
    const interop = createResource(kind, harness);

    harness.registry.set(
      L2_INTEROP_ROOT_STORAGE_ADDRESS,
      IInteropRootStorage,
      'interopRoots',
      INTEROP_ROOT,
      [ROOT_CHAIN_ID, BATCH_NUMBER],
    );

    const result = await interop.getInteropRoot(harness.l2 as any, ROOT_CHAIN_ID, BATCH_NUMBER);
    expect(result).toBe(INTEROP_ROOT);
  });
});

// ---------------------------------------------------------------------------
// verifyBundle
// ---------------------------------------------------------------------------

describeForAdapters('adapters/interop/verifyBundle', (kind, factory) => {
  it('sends verifyBundle transaction and returns bundleHash + dstExecTxHash', async () => {
    const harness = factory();
    const interop = createResource(kind, harness);

    if (kind === 'ethers') {
      (harness.signer as any).sendTransaction = async () => ({ hash: VERIFY_TX_HASH });
      // ethers Contract.wait() polls provider.getTransactionReceipt internally
      (harness.l2 as any).getTransactionReceipt = async () => ({ hash: VERIFY_TX_HASH, status: 1, logs: [] });
    } else {
      mockViemTransport(harness.l2, VERIFY_TX_HASH, 'success');
    }

    const result = await interop.verifyBundle(harness.l2 as any, FINALIZATION_INFO);

    expect(result.bundleHash).toBe(BUNDLE_HASH);
    expect(result.dstExecTxHash).toBe(VERIFY_TX_HASH);
  });

  it('throws when the verifyBundle transaction fails', async () => {
    const harness = factory();
    const interop = createResource(kind, harness);

    if (kind === 'ethers') {
      // Simulate send-level failure so we don't need to wire up receipt polling
      (harness.signer as any).sendTransaction = async () => {
        throw new Error('execution reverted');
      };
    } else {
      mockViemTransport(harness.l2, VERIFY_TX_HASH, 'reverted');
    }

    let caught: unknown;
    try {
      await interop.verifyBundle(harness.l2 as any, FINALIZATION_INFO);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
  });
});
