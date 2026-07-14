import { describe, expect, it } from 'bun:test';

import { ATOMIC_COMMIT_LEAF_TAG } from '../../../core/resources/interop/atomic';
import type { Hex } from '../../../core/types/primitives';
import { ethersAtomicInteropCodec } from '../../ethers/resources/interop/atomic-codec';
import { viemAtomicInteropCodec } from '../../viem/resources/interop/atomic-codec';

const HASH_1 = `0x${'11'.repeat(32)}` as Hex;
const HASH_2 = `0x${'22'.repeat(32)}` as Hex;

describe('atomic interop adapter codecs', () => {
  it('produces identical protocol flow and commit hash vectors', () => {
    const flowInput = {
      legBundleHashes: [HASH_1, HASH_2],
      legSourceChainIds: [324n, 270n],
      deadline: 1_900_000_000n,
      settlementLayerChainId: 1n,
    } as const;
    const ethersFlowId = ethersAtomicInteropCodec.hashFlow(flowInput);
    const viemFlowId = viemAtomicInteropCodec.hashFlow(flowInput);

    expect(ethersFlowId).toBe('0xebc86d7d5941bf0caa903c9eecc123d6ca97bd2f413fd114002e41c206155b36');
    expect(viemFlowId).toBe(ethersFlowId);

    const commitInput = {
      tag: ATOMIC_COMMIT_LEAF_TAG,
      flowId: ethersFlowId,
      bundleHash: HASH_1,
    };
    const ethersCommitHash = ethersAtomicInteropCodec.hashCommit(commitInput);
    const viemCommitHash = viemAtomicInteropCodec.hashCommit(commitInput);

    expect(ethersCommitHash).toBe(
      '0x0cb8dbaa64b99f59f8edddf5c136dff3ced7a82c9b7bf5340575c35fe3feb7f4',
    );
    expect(viemCommitHash).toBe(ethersCommitHash);
  });
});
