// tests/withdrawals/finalization.test.ts
import { describe, it, expect } from 'bun:test';
import { AbiCoder, concat, keccak256 } from 'ethers';

import {
  BundleStatus,
  CallStatus,
  buildWithdrawalFinalization,
  classifyBundleOutcome,
  isBundleFinalized,
  keccakHex,
  parseBundleHashFromLogs,
  stripBundleIdentifier,
} from '../finalization';
import { BUNDLE_IDENTIFIER, L2_INTEROP_CENTER_ADDRESS } from '../../../constants';
import type { Address, Hex } from '../../../types/primitives';

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
  it('treats only FullyExecuted as finalized', () => {
    expect(isBundleFinalized(BundleStatus.FullyExecuted)).toBe(true);
    // Deliberately NOT true for `Unbundled`: without the call status it cannot tell a successful
    // unbundle from a cancelled one. That is why it is deprecated in favour of
    // `classifyBundleOutcome`.
    expect(isBundleFinalized(BundleStatus.Unbundled)).toBe(false);
  });

  it('treats unreceived and verified as not yet finalized', () => {
    // `Verified` only means the inclusion proof landed; the calls have not run.
    expect(isBundleFinalized(BundleStatus.Unreceived)).toBe(false);
    expect(isBundleFinalized(BundleStatus.Verified)).toBe(false);
  });
});

describe('withdrawals/parseBundleHashFromLogs', () => {
  const word = (b: string) => b.repeat(32);
  const EMITTED = `0x${word('42')}` as Hex;

  // InteropBundleSent(bytes32, bytes32, InteropBundle): all non-indexed, so one topic, and the
  // hash is the second data word regardless of the bundle tuple's shape.
  const sentLog = {
    address: L2_INTEROP_CENTER_ADDRESS,
    topics: [`0x${word('aa')}`],
    data: `0x${word('11')}${word('42')}${word('00')}`,
  };

  it('reads the emitted bundle hash positionally', () => {
    expect(parseBundleHashFromLogs([sentLog])).toBe(EMITTED);
  });

  it('is indifferent to topic0, which moved when BundleAttributes gained salt', () => {
    const other = { ...sentLog, topics: [`0x${word('bb')}`] };
    expect(parseBundleHashFromLogs([other])).toBe(EMITTED);
  });

  it("ignores the InteropCenter's indexed events", () => {
    // e.g. ProtocolFeesAccumulated(address indexed, uint256) — two topics.
    const fee = {
      address: L2_INTEROP_CENTER_ADDRESS,
      topics: [`0x${word('cc')}`, `0x${word('dd')}`],
      data: `0x${word('99')}${word('99')}${word('99')}`,
    };
    expect(parseBundleHashFromLogs([fee, sentLog])).toBe(EMITTED);
  });

  it('ignores single-topic logs from other emitters', () => {
    const foreign = { ...sentLog, address: '0x000000000000000000000000000000000001000e' };
    expect(parseBundleHashFromLogs([foreign])).toBeUndefined();
  });

  it('ignores a truncated payload', () => {
    const short = { ...sentLog, data: `0x${word('11')}${word('42')}` };
    expect(parseBundleHashFromLogs([short])).toBeUndefined();
  });

  it('returns undefined when no bundle was sent', () => {
    expect(parseBundleHashFromLogs([])).toBeUndefined();
  });
});

describe('withdrawals/buildWithdrawalFinalization bundle hash', () => {
  it('prefers the emitted hash over recomputing it', () => {
    // On the current contracts the two agree; preferring the emitted one means the SDK carries no
    // assumption about the derivation at all. Asserted with a value that cannot collide with
    // `keccak256(bundle)` so the precedence is actually observable.
    const emitted = `0x${'77'.repeat(32)}` as Hex;
    const result = buildWithdrawalFinalization({
      messageData: MESSAGE,
      sourceChainId: 271n,
      txNumberInBatch: 3,
      proof: PROOF,
      bundleHash: emitted,
    });

    expect(result.bundleHash).toBe(emitted);
    expect(result.bundleHash).not.toBe(keccak256(BUNDLE));
  });

  it('falls back to keccak256(bundle) when nothing was emitted', () => {
    const result = buildWithdrawalFinalization({
      messageData: MESSAGE,
      sourceChainId: 271n,
      txNumberInBatch: 3,
      proof: PROOF,
    });
    expect(result.bundleHash).toBe(keccak256(BUNDLE));
  });
});

describe('withdrawals/classifyBundleOutcome', () => {
  it('treats FullyExecuted as finalized regardless of call status', () => {
    expect(classifyBundleOutcome(BundleStatus.FullyExecuted)).toBe('finalized');
    expect(classifyBundleOutcome(BundleStatus.FullyExecuted, CallStatus.Unprocessed)).toBe(
      'finalized',
    );
  });

  it('treats an unbundled-but-executed call as finalized', () => {
    expect(classifyBundleOutcome(BundleStatus.Unbundled, CallStatus.Executed)).toBe('finalized');
  });

  it('treats an unbundled-and-cancelled call as terminal failure, not success', () => {
    // `unbundleBundle` lets the unbundler cancel a call instead of executing it, so the funds were
    // never released. Reporting this as finalized would tell the user they had been paid.
    expect(classifyBundleOutcome(BundleStatus.Unbundled, CallStatus.Cancelled)).toBe('failed');
  });

  it('treats an unbundled-but-untouched call as still pending', () => {
    // A later `unbundleBundle` can still execute it, so this is not terminal.
    expect(classifyBundleOutcome(BundleStatus.Unbundled, CallStatus.Unprocessed)).toBe('pending');
    expect(classifyBundleOutcome(BundleStatus.Unbundled)).toBe('pending');
  });

  it('treats unreceived and verified as pending', () => {
    expect(classifyBundleOutcome(BundleStatus.Unreceived)).toBe('pending');
    expect(classifyBundleOutcome(BundleStatus.Verified)).toBe('pending');
  });
});

describe('withdrawals/buildWithdrawalFinalization interop center', () => {
  it('names the resolved InteropCenter as the proof sender', () => {
    // The L1 handler checks `message.sender`, so a client using `overrides.interopCenter` must get
    // its override here — hard-coding the canonical address would make the bundle unfinalizable.
    const override = '0x00000000000000000000000000000000000abcde' as Address;
    const result = buildWithdrawalFinalization({
      messageData: MESSAGE,
      sourceChainId: 271n,
      txNumberInBatch: 0,
      proof: PROOF,
      interopCenter: override,
    });
    expect(result.proof.message.sender).toBe(override);
  });

  it('falls back to the canonical InteropCenter', () => {
    const result = buildWithdrawalFinalization({
      messageData: MESSAGE,
      sourceChainId: 271n,
      txNumberInBatch: 0,
      proof: PROOF,
    });
    expect(result.proof.message.sender).toBe(L2_INTEROP_CENTER_ADDRESS);
  });
});

describe('withdrawals/parseBundleHashFromLogs interop center', () => {
  it('matches on the resolved InteropCenter, not the canonical one', () => {
    const override = '0x00000000000000000000000000000000000abcde' as Address;
    const log = {
      address: override,
      topics: [`0x${'aa'.repeat(32)}`],
      data: `0x${'11'.repeat(32)}${'42'.repeat(32)}${'00'.repeat(32)}`,
    };
    expect(parseBundleHashFromLogs([log], override)).toBe(`0x${'42'.repeat(32)}`);
    // Same log, canonical expectation: not this center's event.
    expect(parseBundleHashFromLogs([log])).toBeUndefined();
  });
});
