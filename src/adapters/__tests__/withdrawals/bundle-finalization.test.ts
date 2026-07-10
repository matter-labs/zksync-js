import { AbiCoder, Interface } from 'ethers';
import { describe, expect, it } from 'bun:test';
import { createWithdrawalBundleFinalizationServices as createEthersServices } from '../../ethers/resources/withdrawals/services/bundle-finalization';
import { createWithdrawalBundleFinalizationServices as createViemServices } from '../../viem/resources/withdrawals/services/bundle-finalization';
import { createAdapterHarness, describeForAdapters } from '../adapter-harness';
import { IInteropCenterABI, IL1InteropHandlerABI, IL1NullifierABI } from '../../../core/abi';
import {
  L1_MESSENGER_ADDRESS,
  L2_INTEROP_CENTER_ADDRESS,
  TOPIC_L1_MESSAGE_SENT_LEG,
} from '../../../core/constants';
import type { InteropFinalizationInfo } from '../../../core/types/flows/interop';
import type { Address, Hex } from '../../../core/types/primitives';
import { ADAPTER_TEST_ADDRESSES } from '../adapter-harness';

const HANDLER = '0x5555555555555555555555555555555555555555' as Address;
const SOURCE_TX_HASH = `0x${'11'.repeat(32)}` as Hex;
const BUNDLE_HASH = `0x${'22'.repeat(32)}` as Hex;
const EXECUTION_TX_HASH = `0x${'33'.repeat(32)}` as Hex;
const ZERO_HASH = `0x${'00'.repeat(32)}` as Hex;
const PROOF_HASH = `0x${'44'.repeat(32)}` as Hex;

const FINALIZATION_INFO: InteropFinalizationInfo = {
  l2SrcTxHash: SOURCE_TX_HASH,
  bundleHash: BUNDLE_HASH,
  dstChainId: 1n,
  encodedData: '0xdeadbeef',
  proof: {
    chainId: 324n,
    l1BatchNumber: 10n,
    l2MessageIndex: 3n,
    message: {
      txNumberInBatch: 2,
      sender: L2_INTEROP_CENTER_ADDRESS,
      data: '0x01deadbeef',
    },
    proof: [PROOF_HASH],
  },
};

function seedHandler(harness: any, bundleStatus: number) {
  harness.registry.set(
    ADAPTER_TEST_ADDRESSES.l1Nullifier,
    new Interface(IL1NullifierABI as any),
    'l1InteropHandler',
    HANDLER,
  );
  harness.registry.set(
    HANDLER,
    new Interface(IL1InteropHandlerABI as any),
    'bundleStatus',
    bundleStatus,
    [BUNDLE_HASH],
  );
}

function createBundleReceipt() {
  const center = new Interface(IInteropCenterABI as any);
  const event = center.encodeEventLog(center.getEvent('InteropBundleSent')!, [
    ZERO_HASH,
    BUNDLE_HASH,
    {
      version: '0x01',
      sourceChainId: 324n,
      destinationChainId: 1n,
      destinationBaseTokenAssetId: ZERO_HASH,
      interopBundleSalt: ZERO_HASH,
      calls: [],
      bundleAttributes: {
        executionAddress: '0x',
        unbundlerAddress: '0x',
        useFixedFee: false,
      },
    },
  ]);
  return {
    to: L2_INTEROP_CENTER_ADDRESS,
    transactionIndex: '0x2',
    blockNumber: 10,
    logs: [
      {
        address: L1_MESSENGER_ADDRESS,
        topics: [TOPIC_L1_MESSAGE_SENT_LEG],
        data: AbiCoder.defaultAbiCoder().encode(['bytes'], ['0x01deadbeef']) as Hex,
        transactionHash: SOURCE_TX_HASH,
      },
      {
        address: L2_INTEROP_CENTER_ADDRESS,
        topics: event.topics as Hex[],
        data: event.data as Hex,
        transactionHash: SOURCE_TX_HASH,
      },
    ],
  };
}

const SERVICES = {
  ethers: createEthersServices,
  viem: createViemServices,
} as const;

describeForAdapters('adapters/withdrawals/L1 bundle finalization', (kind, factory) => {
  it('resolves L1InteropHandler and maps bundleStatus', async () => {
    const harness = factory();
    seedHandler(harness, 1);
    const services = SERVICES[kind](harness.client as never);

    expect(await services.resolveHandler()).toBe(HANDLER);
    expect(await services.readBundleState(BUNDLE_HASH)).toBe('VERIFIED');
  });

  it('assembles the emitted bundle with a MessageRoot proof', async () => {
    const harness = factory();
    const receipt = createBundleReceipt();
    (harness.client.zks as any).getReceiptWithL2ToL1 = async () => receipt;
    let proofTarget: unknown;
    (harness.client.zks as any).getL2ToL1LogProof = async (
      _hash: Hex,
      _index: number,
      target: unknown,
    ) => {
      proofTarget = target;
      return {
        id: 3n,
        batchNumber: 10n,
        proof: [PROOF_HASH],
        root: ZERO_HASH,
      };
    };
    const services = SERVICES[kind](harness.client as never);

    const info = await services.fetchBundleFinalizationInfo(SOURCE_TX_HASH);

    expect(info.bundleHash).toBe(BUNDLE_HASH);
    expect(info.encodedData).toBe('0xdeadbeef');
    expect(info.proof.message.sender).toBe(L2_INTEROP_CENTER_ADDRESS);
    expect(info.proof.message.txNumberInBatch).toBe(2);
    expect(proofTarget).toBe('messageRoot');
  });

  it('classifies a paused executeBundle simulation as temporarily not ready', async () => {
    const harness = factory();
    seedHandler(harness, 0);
    if (kind === 'ethers') {
      const originalCall = harness.l1.call.bind(harness.l1);
      harness.l1.call = async (tx: { to?: string; data?: string }) => {
        const executeSelector = new Interface(IL1InteropHandlerABI as any)
          .getFunction('executeBundle')!
          .selector.toLowerCase();
        if (
          tx.to?.toLowerCase() === HANDLER.toLowerCase() &&
          tx.data?.slice(0, 10).toLowerCase() === executeSelector
        ) {
          throw new Error('contract is paused');
        }
        return originalCall(tx);
      };
    } else {
      harness.setSimulateError(new Error('contract is paused'), 'l1');
    }
    const services = SERVICES[kind](harness.client as never);

    expect(await services.simulateExecuteBundle(FINALIZATION_INFO)).toEqual({
      kind: 'NOT_READY',
      reason: 'paused',
    });
  });

  it('submits executeBundle to L1InteropHandler and returns its receipt', async () => {
    const harness = factory();
    seedHandler(harness, 0);
    let sent: any;
    if (kind === 'ethers') {
      (harness.signer as any).sendTransaction = async (tx: any) => {
        sent = tx;
        return {
          hash: EXECUTION_TX_HASH,
          wait: async () => ({ status: 1, hash: EXECUTION_TX_HASH }),
        };
      };
      (harness.l1 as any).getTransactionReceipt = async () => ({
        status: 1,
        hash: EXECUTION_TX_HASH,
        transactionHash: EXECUTION_TX_HASH,
        blockNumber: 1,
        blockHash: ZERO_HASH,
        logs: [],
        confirmations: async () => 1,
      });
      (harness.l1 as any).getBlockNumber = async () => 1;
    } else {
      (harness.l1Wallet as any).writeContract = async (request: any) => {
        sent = request;
        return EXECUTION_TX_HASH;
      };
      (harness.l1 as any).waitForTransactionReceipt = async () => ({
        status: 'success',
        transactionHash: EXECUTION_TX_HASH,
      });
    }
    const services = SERVICES[kind](harness.client as never);

    const execution = await services.executeBundle(FINALIZATION_INFO);
    const receipt = await execution.wait();

    expect(execution.hash).toBe(EXECUTION_TX_HASH);
    if (kind === 'ethers') {
      expect((sent.to as string).toLowerCase()).toBe(HANDLER.toLowerCase());
      expect(new Interface(IL1InteropHandlerABI as any).parseTransaction(sent)?.name).toBe(
        'executeBundle',
      );
    } else {
      expect(sent.address).toBe(HANDLER);
      expect(sent.functionName).toBe('executeBundle');
    }
    expect(receipt).toBeDefined();
  });
});

describe('withdrawal L1 bundle driver construction', () => {
  it('does not require a destination InteropRoot provider', () => {
    const harness = createAdapterHarness('ethers');
    const services = createEthersServices(harness.client);
    expect(Object.keys(services).sort()).toEqual([
      'executeBundle',
      'fetchBundleFinalizationInfo',
      'readBundleState',
      'resolveHandler',
      'simulateExecuteBundle',
      'waitForBundleFinalization',
    ]);
  });
});
