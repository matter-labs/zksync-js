import { describe, it, expect } from 'bun:test';

import { createInteropResource } from '../../ethers/resources/interop/index.ts';
import { createEthersHarness } from '../adapter-harness.ts';
import type { Address, Hex } from '../../../core/types/primitives.ts';

const RECIPIENT = '0x2222222222222222222222222222222222222222' as Address;
const TX_HASH = `0x${'aa'.repeat(32)}` as Hex;

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

  it('create fetches nonce from pending transaction count', async () => {
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
});
