import { describe, it, expect } from 'bun:test';

import { createInteropResource } from '../../ethers/resources/interop/index.ts';
import {
  createEthersHarness,
  setErc20Allowance,
  setL2TokenRegistration,
} from '../adapter-harness.ts';
import type { Address, Hex } from '../../../core/types/primitives.ts';

const RECIPIENT = '0x2222222222222222222222222222222222222222' as Address;
const TX_HASH = `0x${'aa'.repeat(32)}` as Hex;
const ERC20_TOKEN = '0x3333333333333333333333333333333333333333' as Address;
const ASSET_ID = `0x${'11'.repeat(32)}` as Hex;

describe('adapters/interop/resource', () => {
  it('status returns SENT when source receipt is not yet available', async () => {
    const harness = createEthersHarness();
    const interop = createInteropResource(harness.client);

    (harness.l2 as any).getTransactionReceipt = async () => null;

    const status = await interop.status({
      dstChain: harness.l2 as any,
      waitable: TX_HASH,
    });
    expect(status.phase).toBe('SENT');
    expect(status.l2SrcTxHash).toBe(TX_HASH);
  });

  it('create fetches nonce from pending transaction count by default', async () => {
    const harness = createEthersHarness();
    const interop = createInteropResource(harness.client);

    let requestedBlockTag: string | undefined;
    (harness.l2 as any).getTransactionCount = async (_from: string, blockTag: string) => {
      requestedBlockTag = blockTag;
      return 7;
    };

    (harness.signer as any).sendTransaction = async () => ({
      hash: TX_HASH,
      wait: async () => ({ status: 1 }),
    });

    const handle = await interop.create({
      dstChain: harness.l2 as any,
      actions: [{ type: 'sendNative', to: RECIPIENT, amount: 1n }],
    });

    expect(requestedBlockTag).toBe('pending');
    expect(handle.l2SrcTxHash).toBe(TX_HASH);
  });

  it('create fetches nonce using txOverrides block tag', async () => {
    const harness = createEthersHarness();
    const interop = createInteropResource(harness.client);

    let requestedBlockTag: string | undefined;
    (harness.l2 as any).getTransactionCount = async (_from: string, blockTag: string) => {
      requestedBlockTag = blockTag;
      return 7;
    };

    (harness.signer as any).sendTransaction = async () => ({
      hash: TX_HASH,
      wait: async () => ({ status: 1 }),
    });

    const handle = await interop.create({
      dstChain: harness.l2 as any,
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
    const harness = createEthersHarness();
    const interop = createInteropResource(harness.client);

    const sender = (await harness.signer.getAddress()) as Address;
    const { l2NativeTokenVault } = await harness.client.ensureAddresses();
    setL2TokenRegistration(harness, l2NativeTokenVault, ERC20_TOKEN, ASSET_ID);
    setErc20Allowance(harness, ERC20_TOKEN, sender, l2NativeTokenVault, 0n);

    let txCountCalls = 0;
    (harness.l2 as any).getTransactionCount = async () => {
      txCountCalls += 1;
      return 999;
    };

    const sentNonces: Array<number | undefined> = [];
    (harness.signer as any).sendTransaction = async (tx: { nonce?: number }) => {
      sentNonces.push(tx.nonce);
      return {
        hash: TX_HASH,
        wait: async () => ({ status: 1 }),
      };
    };

    await interop.create({
      dstChain: harness.l2 as any,
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
});
