// tests/withdrawals/finalization.test.ts
import { describe, it, expect } from 'bun:test';
import { AbiCoder, concat, keccak256 } from 'ethers';

import {
  BundleStatus,
  buildWithdrawalFinalization,
  isBundleFinalized,
  keccakHex,
  stripBundleIdentifier,
} from '../finalization';
import { BUNDLE_IDENTIFIER, L2_INTEROP_CENTER_ADDRESS } from '../../../constants';
import type { Hex } from '../../../types/primitives';

const BUNDLE = AbiCoder.defaultAbiCoder().encode(['uint256', 'string'], [42n, 'bundle']) as Hex;
const MESSAGE = concat([BUNDLE_IDENTIFIER, BUNDLE]) as Hex;

const PROOF = {
  batchNumber: 1234n,
  id: 7n,
  proof: [`0x${'ab'.repeat(32)}`, `0x${'cd'.repeat(32)}`] as Hex[],
};

describe('withdrawals/keccakHex', () => {
  it('matches ethers keccak256 over the same bytes', () => {
    expect(keccakHex(BUNDLE)).toBe(keccak256(BUNDLE));
    expect(keccakHex('0x')).toBe(keccak256('0x'));
  });
});

describe('withdrawals/stripBundleIdentifier', () => {
  it('removes the 0x01 bundle prefix', () => {
    expect(stripBundleIdentifier(MESSAGE)).toBe(BUNDLE);
  });

  it('rejects a message without the bundle prefix', () => {
    // A v31-style withdrawal message starts with the `finalizeEthWithdrawal` selector, so this is
    // the shape a pre-upgrade in-flight withdrawal would present.
    const legacy = concat(['0x6c0960f9', `0x${'11'.repeat(32)}`]) as Hex;
    expect(() => stripBundleIdentifier(legacy)).toThrow(/not an interop bundle/);
  });
});

describe('withdrawals/buildWithdrawalFinalization', () => {
  const result = buildWithdrawalFinalization({
    messageData: MESSAGE,
    sourceChainId: 271n,
    txNumberInBatch: 3,
    proof: PROOF,
  });

  it('exposes the ABI-encoded bundle without its prefix', () => {
    expect(result.bundle).toBe(BUNDLE);
  });

  it('derives the bundle hash as keccak256 of the encoded bundle', () => {
    // Matches `InteropDataEncoding.encodeInteropBundleHash`, so it is stable across the v31→v32
    // `BundleAttributes` change that moved the InteropBundleSent topic0.
    expect(result.bundleHash).toBe(keccak256(BUNDLE));
  });

  it('builds a MessageInclusionProof sent by the L2 InteropCenter', () => {
    expect(result.proof).toEqual({
      chainId: 271n,
      l1BatchNumber: PROOF.batchNumber,
      l2MessageIndex: PROOF.id,
      message: {
        txNumberInBatch: 3,
        // The handler rejects any other sender.
        sender: L2_INTEROP_CENTER_ADDRESS,
        data: MESSAGE,
      },
      proof: PROOF.proof,
    });
  });
});

describe('withdrawals/isBundleFinalized', () => {
  it('treats executed and unbundled as finalized', () => {
    expect(isBundleFinalized(BundleStatus.FullyExecuted)).toBe(true);
    expect(isBundleFinalized(BundleStatus.Unbundled)).toBe(true);
  });

  it('treats unreceived and verified as not yet finalized', () => {
    // `Verified` only means the inclusion proof landed; the calls have not run.
    expect(isBundleFinalized(BundleStatus.Unreceived)).toBe(false);
    expect(isBundleFinalized(BundleStatus.Verified)).toBe(false);
  });
});
