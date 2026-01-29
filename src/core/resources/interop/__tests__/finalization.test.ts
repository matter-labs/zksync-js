// tests/interop/finalization.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'bun:test';
import {
  resolveIdsFromWaitable,
  isL1MessageSentLog,
  parseBundleSentFromReceipt,
  parseBundleReceiptInfo,
  getBundleEncodedData,
  buildFinalizationInfo,
  createTimeoutError,
  createStateError,
  ZERO_HASH,
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
} from '../finalization';
import type { InteropLog } from '../finalization';
import {
  L1_MESSENGER_ADDRESS,
  TOPIC_L1_MESSAGE_SENT_LEG,
  BUNDLE_IDENTIFIER,
  L2_INTEROP_CENTER_ADDRESS,
} from '../../../constants';
import type { Hex, Address } from '../../../types/primitives';

const TX_HASH = '0x1234567890123456789012345678901234567890123456789012345678901234' as Hex;
const BUNDLE_HASH = '0xabcdef1234567890123456789012345678901234567890123456789012345678' as Hex;
const INTEROP_CENTER = '0x000000000000000000000000000000000001000d' as Address;
const INTEROP_BUNDLE_SENT_TOPIC = '0xinteropbundlesenttopic00000000000000000000000000000000000000' as Hex;

describe('interop/finalization', () => {
  describe('constants', () => {
    it('exports ZERO_HASH as 64 zeros', () => {
      expect(ZERO_HASH).toBe(`0x${'0'.repeat(64)}`);
    });

    it('exports DEFAULT_POLL_MS as 1 second', () => {
      expect(DEFAULT_POLL_MS).toBe(1_000);
    });

    it('exports DEFAULT_TIMEOUT_MS as 5 minutes', () => {
      expect(DEFAULT_TIMEOUT_MS).toBe(300_000);
    });
  });

  describe('resolveIdsFromWaitable', () => {
    it('resolves string input as l2SrcTxHash', () => {
      const result = resolveIdsFromWaitable(TX_HASH);
      expect(result).toEqual({ l2SrcTxHash: TX_HASH });
    });

    it('resolves object input with all fields', () => {
      const handle = {
        l2SrcTxHash: TX_HASH,
        bundleHash: BUNDLE_HASH,
        dstChainId: 2n,
        dstExecTxHash: '0xexec' as Hex,
      };
      const result = resolveIdsFromWaitable(handle as any);
      expect(result).toEqual({
        l2SrcTxHash: TX_HASH,
        bundleHash: BUNDLE_HASH,
        dstChainId: 2n,
        dstExecTxHash: '0xexec',
      });
    });

    it('handles partial object input', () => {
      const handle = { l2SrcTxHash: TX_HASH };
      const result = resolveIdsFromWaitable(handle as any);
      expect(result.l2SrcTxHash).toBe(TX_HASH);
      expect(result.bundleHash).toBeUndefined();
      expect(result.dstChainId).toBeUndefined();
    });
  });

  describe('isL1MessageSentLog', () => {
    it('returns true for matching L1MessageSent log', () => {
      const log: InteropLog = {
        address: L1_MESSENGER_ADDRESS,
        topics: [TOPIC_L1_MESSAGE_SENT_LEG],
        data: '0x',
        transactionHash: TX_HASH,
      };
      expect(isL1MessageSentLog(log)).toBe(true);
    });

    it('returns true for case-insensitive address match', () => {
      const log: InteropLog = {
        address: L1_MESSENGER_ADDRESS.toLowerCase() as Address,
        topics: [TOPIC_L1_MESSAGE_SENT_LEG.toUpperCase() as Hex],
        data: '0x',
        transactionHash: TX_HASH,
      };
      expect(isL1MessageSentLog(log)).toBe(true);
    });

    it('returns false for non-matching address', () => {
      const log: InteropLog = {
        address: '0x0000000000000000000000000000000000001234' as Address,
        topics: [TOPIC_L1_MESSAGE_SENT_LEG],
        data: '0x',
        transactionHash: TX_HASH,
      };
      expect(isL1MessageSentLog(log)).toBe(false);
    });

    it('returns false for non-matching topic', () => {
      const log: InteropLog = {
        address: L1_MESSENGER_ADDRESS,
        topics: ['0xdeadbeef'],
        data: '0x',
        transactionHash: TX_HASH,
      };
      expect(isL1MessageSentLog(log)).toBe(false);
    });
  });

  describe('parseBundleSentFromReceipt', () => {
    it('parses bundle hash and destination chain from receipt', () => {
      const receipt = {
        logs: [
          {
            address: INTEROP_CENTER,
            topics: [INTEROP_BUNDLE_SENT_TOPIC, '0xother'],
            data: '0xdata',
            transactionHash: TX_HASH,
          },
        ],
      };
      const decodeInteropBundleSent = () => ({
        bundleHash: BUNDLE_HASH,
        sourceChainId: 1n,
        destinationChainId: 2n,
      });

      const result = parseBundleSentFromReceipt({
        receipt,
        interopCenter: INTEROP_CENTER,
        interopBundleSentTopic: INTEROP_BUNDLE_SENT_TOPIC,
        decodeInteropBundleSent,
      });

      expect(result.bundleHash).toBe(BUNDLE_HASH);
      expect(result.dstChainId).toBe(2n);
    });

    it('handles case-insensitive matching', () => {
      const receipt = {
        logs: [
          {
            address: INTEROP_CENTER.toLowerCase() as Address,
            topics: [INTEROP_BUNDLE_SENT_TOPIC.toLowerCase() as Hex],
            data: '0x',
            transactionHash: TX_HASH,
          },
        ],
      };
      const decodeInteropBundleSent = () => ({
        bundleHash: BUNDLE_HASH,
        sourceChainId: 1n,
        destinationChainId: 2n,
      });

      const result = parseBundleSentFromReceipt({
        receipt,
        interopCenter: INTEROP_CENTER.toUpperCase() as Address,
        interopBundleSentTopic: INTEROP_BUNDLE_SENT_TOPIC.toUpperCase() as Hex,
        decodeInteropBundleSent,
      });

      expect(result.bundleHash).toBe(BUNDLE_HASH);
    });

    it('throws when no matching log found', () => {
      const receipt = {
        logs: [
          {
            address: '0x1111111111111111111111111111111111111111' as Address,
            topics: ['0xdeadbeef'],
            data: '0x',
            transactionHash: TX_HASH,
          },
        ],
      };

      expect(() =>
        parseBundleSentFromReceipt({
          receipt,
          interopCenter: INTEROP_CENTER,
          interopBundleSentTopic: INTEROP_BUNDLE_SENT_TOPIC,
          decodeInteropBundleSent: () => ({ bundleHash: BUNDLE_HASH, sourceChainId: 1n, destinationChainId: 2n }),
        }),
      ).toThrow(/Failed to locate InteropBundleSent event/);
    });
  });

  describe('parseBundleReceiptInfo', () => {
    const baseParams = () => ({
      interopCenter: INTEROP_CENTER,
      interopBundleSentTopic: INTEROP_BUNDLE_SENT_TOPIC,
      decodeInteropBundleSent: () => ({
        bundleHash: BUNDLE_HASH,
        sourceChainId: 1n,
        destinationChainId: 2n,
      }),
      decodeL1MessageData: () => '0x01encodeddata' as Hex,
      l2SrcTxHash: TX_HASH,
    });

    it('parses bundle receipt info with L1MessageSent log', () => {
      const rawReceipt = {
        logs: [
          {
            address: L1_MESSENGER_ADDRESS,
            topics: [TOPIC_L1_MESSAGE_SENT_LEG],
            data: '0xmessagedata',
            transactionHash: TX_HASH,
          },
          {
            address: INTEROP_CENTER,
            topics: [INTEROP_BUNDLE_SENT_TOPIC],
            data: '0xbundledata',
            transactionHash: TX_HASH,
          },
        ],
        transactionIndex: 5,
      };

      const result = parseBundleReceiptInfo({
        ...baseParams(),
        rawReceipt: rawReceipt as any,
      });

      expect(result.bundleHash).toBe(BUNDLE_HASH);
      expect(result.dstChainId).toBe(2n);
      expect(result.sourceChainId).toBe(1n);
      expect(result.l1MessageData).toBe('0x01encodeddata');
      expect(result.l2ToL1LogIndex).toBe(0);
      expect(result.txNumberInBatch).toBe(5);
    });

    it('increments l2ToL1LogIndex for multiple L1MessageSent logs', () => {
      const rawReceipt = {
        logs: [
          {
            address: L1_MESSENGER_ADDRESS,
            topics: [TOPIC_L1_MESSAGE_SENT_LEG],
            data: '0x',
            transactionHash: TX_HASH,
          },
          {
            address: L1_MESSENGER_ADDRESS,
            topics: [TOPIC_L1_MESSAGE_SENT_LEG],
            data: '0x',
            transactionHash: TX_HASH,
          },
          {
            address: INTEROP_CENTER,
            topics: [INTEROP_BUNDLE_SENT_TOPIC],
            data: '0x',
            transactionHash: TX_HASH,
          },
        ],
        transactionIndex: 0,
      };

      const result = parseBundleReceiptInfo({
        ...baseParams(),
        rawReceipt: rawReceipt as any,
      });

      expect(result.l2ToL1LogIndex).toBe(1);
    });

    it('throws when no InteropBundleSent log found', () => {
      const rawReceipt = {
        logs: [
          {
            address: L1_MESSENGER_ADDRESS,
            topics: [TOPIC_L1_MESSAGE_SENT_LEG],
            data: '0x',
            transactionHash: TX_HASH,
          },
        ],
        transactionIndex: 0,
      };

      expect(() =>
        parseBundleReceiptInfo({
          ...baseParams(),
          rawReceipt: rawReceipt as any,
        }),
      ).toThrow(/Failed to locate InteropBundleSent event/);
    });

    it('throws when no L1MessageSent log found', () => {
      const rawReceipt = {
        logs: [
          {
            address: INTEROP_CENTER,
            topics: [INTEROP_BUNDLE_SENT_TOPIC],
            data: '0x',
            transactionHash: TX_HASH,
          },
        ],
        transactionIndex: 0,
      };

      expect(() =>
        parseBundleReceiptInfo({
          ...baseParams(),
          rawReceipt: rawReceipt as any,
        }),
      ).toThrow(/Failed to locate L1MessageSent log data/);
    });

    it('throws when decodeL1MessageData fails', () => {
      const rawReceipt = {
        logs: [
          {
            address: L1_MESSENGER_ADDRESS,
            topics: [TOPIC_L1_MESSAGE_SENT_LEG],
            data: '0x',
            transactionHash: TX_HASH,
          },
          {
            address: INTEROP_CENTER,
            topics: [INTEROP_BUNDLE_SENT_TOPIC],
            data: '0x',
            transactionHash: TX_HASH,
          },
        ],
        transactionIndex: 0,
      };

      expect(() =>
        parseBundleReceiptInfo({
          ...baseParams(),
          decodeL1MessageData: () => {
            throw new Error('decode error');
          },
          rawReceipt: rawReceipt as any,
        }),
      ).toThrow(/Failed to decode L1MessageSent log data/);
    });
  });

  describe('getBundleEncodedData', () => {
    it('strips BUNDLE_IDENTIFIER prefix from message data', () => {
      const messageData = '0x01abcdef1234' as Hex;
      const result = getBundleEncodedData(messageData);
      expect(result).toBe('0xabcdef1234');
    });

    it('throws when prefix does not match BUNDLE_IDENTIFIER', () => {
      const messageData = '0x02abcdef1234' as Hex;
      expect(() => getBundleEncodedData(messageData)).toThrow(/Unexpected bundle prefix/);
    });

    it('handles minimal data after prefix', () => {
      const messageData = '0x01ab' as Hex;
      const result = getBundleEncodedData(messageData);
      expect(result).toBe('0xab');
    });
  });

  describe('buildFinalizationInfo', () => {
    it('builds complete finalization info', () => {
      const ids = { l2SrcTxHash: TX_HASH, bundleHash: BUNDLE_HASH };
      const bundleInfo = {
        bundleHash: BUNDLE_HASH,
        dstChainId: 2n,
        sourceChainId: 1n,
        l1MessageData: '0x01data' as Hex,
        l2ToL1LogIndex: 0,
        txNumberInBatch: 5,
        rawReceipt: {} as any,
      };
      const proof = {
        batchNumber: 100n,
        root: '0xroot1234' as Hex,
        id: 10n,
        proof: ['0xproof1', '0xproof2'] as Hex[],
      };
      const messageData = '0x01encodedmsg' as Hex;

      const result = buildFinalizationInfo(ids, bundleInfo, proof, messageData);

      expect(result.l2SrcTxHash).toBe(TX_HASH);
      expect(result.bundleHash).toBe(BUNDLE_HASH);
      expect(result.dstChainId).toBe(2n);

      expect(result.expectedRoot).toEqual({
        rootChainId: 1n,
        batchNumber: 100n,
        expectedRoot: '0xroot1234',
      });

      expect(result.proof).toEqual({
        chainId: 1n,
        l1BatchNumber: 100n,
        l2MessageIndex: 10n,
        message: {
          txNumberInBatch: 5,
          sender: L2_INTEROP_CENTER_ADDRESS,
          data: messageData,
        },
        proof: ['0xproof1', '0xproof2'],
      });

      expect(result.encodedData).toBe('0xencodedmsg');
    });
  });

  describe('createTimeoutError', () => {
    it('creates a timeout error with correct structure', () => {
      const error = createTimeoutError('waitForExecution', 'Timed out waiting', {
        bundleHash: BUNDLE_HASH,
      });

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Timed out waiting');
    });
  });

  describe('createStateError', () => {
    it('creates a state error with correct structure', () => {
      const error = createStateError('parseReceipt', 'Invalid state', { txHash: TX_HASH });

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Invalid state');
    });
  });
});
