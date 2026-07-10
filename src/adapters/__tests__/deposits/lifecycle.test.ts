import { describe, expect, it } from 'bun:test';
import { createDepositsResource as createEthersDepositsResource } from '../../ethers/resources/deposits';
import { createDepositsResource as createViemDepositsResource } from '../../viem/resources/deposits';
import { describeForAdapters } from '../adapter-harness';
import { TOPIC_CANONICAL_ASSIGNED } from '../../../core/constants';
import type { Address, Hex } from '../../../core/types/primitives';

const L1_TX_HASH = `0x${'11'.repeat(32)}` as Hex;
const L2_TX_HASH = `0x${'22'.repeat(32)}` as Hex;
const ZERO_TOPIC = `0x${'00'.repeat(32)}` as Hex;
const LOG_ADDRESS = '0x3333333333333333333333333333333333333333' as Address;

const RESOURCES = {
  ethers: createEthersDepositsResource,
  viem: createViemDepositsResource,
} as const;

function sourceReceipt(withL2Hash = true) {
  return {
    status: 1,
    logs: withL2Hash
      ? [
          {
            address: LOG_ADDRESS,
            topics: [TOPIC_CANONICAL_ASSIGNED, ZERO_TOPIC, L2_TX_HASH],
            data: '0x' as Hex,
            transactionHash: L1_TX_HASH,
          },
        ]
      : [],
  };
}

describeForAdapters('adapters/deposits/lifecycle', (kind, factory) => {
  it('maps source and destination receipts through the shared priority lifecycle', async () => {
    const harness = factory();
    const deposits = RESOURCES[kind](harness.client as never);

    if (kind === 'ethers') {
      (harness.l1 as any).getTransactionReceipt = async () => sourceReceipt();
      (harness.l2 as any).getTransactionReceipt = async () => ({ status: 1 });
    } else {
      (harness.l1 as any).getTransactionReceipt = async () => sourceReceipt();
      (harness.l2 as any).getTransactionReceipt = async () => ({ status: 'success' });
    }

    const status = await deposits.status(L1_TX_HASH);
    expect(status).toEqual({
      phase: 'L2_EXECUTED',
      l1TxHash: L1_TX_HASH,
      l2TxHash: L2_TX_HASH,
    });
  });

  it('keeps an included source receipt without a derived hash in L1_INCLUDED', async () => {
    const harness = factory();
    const deposits = RESOURCES[kind](harness.client as never);
    (harness.l1 as any).getTransactionReceipt = async () => sourceReceipt(false);

    const status = await deposits.status(L1_TX_HASH);
    expect(status.phase).toBe('L1_INCLUDED');
    expect(status.l2TxHash).toBeUndefined();
  });

  it('waits for the source receipt only once before destination completion', async () => {
    const harness = factory();
    const deposits = RESOURCES[kind](harness.client as never);
    let sourceWaits = 0;

    if (kind === 'ethers') {
      (harness.l1 as any).waitForTransaction = async () => {
        sourceWaits += 1;
        return sourceReceipt();
      };
      (harness.l2 as any).waitForTransaction = async () => ({ status: 1 });
      (harness.l2 as any).getTransactionReceipt = async () => ({ status: 1 });
    } else {
      (harness.l1 as any).waitForTransactionReceipt = async () => {
        sourceWaits += 1;
        return sourceReceipt();
      };
      (harness.l2 as any).waitForTransactionReceipt = async () => ({ status: 'success' });
      (harness.l2 as any).getTransactionReceipt = async () => ({ status: 'success' });
    }

    const receipt = await deposits.wait(L1_TX_HASH, { for: 'l2' });
    expect(sourceWaits).toBe(1);
    expect(receipt).not.toBeNull();
  });
});

describe('deposit lifecycle fixtures', () => {
  it('uses a canonical fallback log that contains the destination hash', () => {
    expect(sourceReceipt().logs[0]?.topics[2]).toBe(L2_TX_HASH);
  });
});
