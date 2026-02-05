import { describe, it, expect } from 'bun:test';
import type {
  InteropExpectedRoot,
  InteropFinalizationInfo,
  InteropMessageProof,
} from '../flows/interop';
import {
  isInteropExpectedRoot,
  isInteropFinalizationInfo,
  isInteropMessageProof,
} from '../flows/interop';
import type { Hex } from '../primitives';

const hash66a = ('0x' + 'a'.repeat(64)) as Hex;
const hash66b = ('0x' + 'b'.repeat(64)) as Hex;
const address = '0x1111111111111111111111111111111111111111' as const;

describe('types/flows/interop.isInteropExpectedRoot', () => {
  it('returns true for valid expected root shape', () => {
    const value: InteropExpectedRoot = {
      rootChainId: 1n,
      batchNumber: 2n,
      expectedRoot: hash66a,
    };

    expect(isInteropExpectedRoot(value)).toBe(true);
  });

  it('returns false for invalid or missing fields', () => {
    expect(isInteropExpectedRoot(null)).toBe(false);
    expect(
      isInteropExpectedRoot({
        rootChainId: 1,
        batchNumber: 2n,
        expectedRoot: hash66a,
      }),
    ).toBe(false);
    expect(
      isInteropExpectedRoot({
        rootChainId: 1n,
        batchNumber: 2n,
        expectedRoot: 'not-hex',
      }),
    ).toBe(false);
  });
});

describe('types/flows/interop.isInteropMessageProof', () => {
  it('returns true for valid proof shape', () => {
    const value: InteropMessageProof = {
      chainId: 324n,
      l1BatchNumber: 100n,
      l2MessageIndex: 0n,
      message: {
        txNumberInBatch: 2,
        sender: address,
        data: '0x1234',
      },
      proof: [hash66a, hash66b],
    };

    expect(isInteropMessageProof(value)).toBe(true);
  });

  it('returns false for invalid nested fields', () => {
    expect(
      isInteropMessageProof({
        chainId: 324n,
        l1BatchNumber: 100n,
        l2MessageIndex: 0n,
        message: {
          txNumberInBatch: 2,
          sender: '0x1234',
          data: '0x1234',
        },
        proof: [hash66a],
      }),
    ).toBe(false);

    expect(
      isInteropMessageProof({
        chainId: 324n,
        l1BatchNumber: 100n,
        l2MessageIndex: 0n,
        message: {
          txNumberInBatch: 2,
          sender: address,
          data: '0x1234',
        },
        proof: ['0x1234'],
      }),
    ).toBe(false);
  });
});

describe('types/flows/interop.isInteropFinalizationInfo', () => {
  it('returns true for a complete valid payload', () => {
    const value: InteropFinalizationInfo = {
      l2SrcTxHash: hash66a,
      bundleHash: hash66b,
      dstChainId: 324n,
      expectedRoot: {
        rootChainId: 1n,
        batchNumber: 7n,
        expectedRoot: hash66a,
      },
      proof: {
        chainId: 324n,
        l1BatchNumber: 100n,
        l2MessageIndex: 0n,
        message: {
          txNumberInBatch: 2,
          sender: address,
          data: '0x1234',
        },
        proof: [hash66a],
      },
      encodedData: '0xdeadbeef',
    };

    expect(isInteropFinalizationInfo(value)).toBe(true);
  });

  it('returns false for invalid top-level or nested values', () => {
    expect(
      isInteropFinalizationInfo({
        l2SrcTxHash: '0x1234',
        bundleHash: hash66b,
        dstChainId: 324n,
        expectedRoot: {
          rootChainId: 1n,
          batchNumber: 7n,
          expectedRoot: hash66a,
        },
        proof: {
          chainId: 324n,
          l1BatchNumber: 100n,
          l2MessageIndex: 0n,
          message: {
            txNumberInBatch: 2,
            sender: address,
            data: '0x1234',
          },
          proof: [hash66a],
        },
        encodedData: '0xdeadbeef',
      }),
    ).toBe(false);

    expect(
      isInteropFinalizationInfo({
        l2SrcTxHash: hash66a,
        bundleHash: hash66b,
        dstChainId: 324n,
        expectedRoot: {
          rootChainId: 1n,
          batchNumber: 7n,
          expectedRoot: hash66a,
        },
        proof: {
          chainId: 324n,
          l1BatchNumber: 100n,
          l2MessageIndex: 0n,
          message: {
            txNumberInBatch: 2,
            sender: address,
            data: '0x1234',
          },
          proof: ['0x1234'],
        },
        encodedData: '0xdeadbeef',
      }),
    ).toBe(false);
  });
});
