// tests/interop/finalization.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'bun:test';
import {
  resolveIdsFromWaitable,
  parseBundleSentFromReceipt,
  parseBundleReceiptInfo,
  getBundleEncodedData,
  buildFinalizationInfo,
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  extractGwBlockNumber,
} from '../finalization';
import { isL1MessageSentLog } from '../../../utils/events';
import type { Log } from '../../../types/transactions';
import {
  L1_MESSENGER_ADDRESS,
  TOPIC_L1_MESSAGE_SENT_LEG,
  L2_INTEROP_CENTER_ADDRESS,
} from '../../../constants';
import type { Hex, Address } from '../../../types/primitives';

const TX_HASH = '0x1234567890123456789012345678901234567890123456789012345678901234' as Hex;
const BUNDLE_HASH = '0xabcdef1234567890123456789012345678901234567890123456789012345678' as Hex;
const INTEROP_CENTER = '0x000000000000000000000000000000000001000d' as Address;
const INTEROP_BUNDLE_SENT_TOPIC =
  '0xinteropbundlesenttopic00000000000000000000000000000000000000' as Hex;

describe('interop/finalization', () => {
  describe('constants', () => {
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
        dstExecTxHash: '0xexec' as Hex,
      };
      const result = resolveIdsFromWaitable(handle as any);
      expect(result).toEqual({
        l2SrcTxHash: TX_HASH,
        bundleHash: BUNDLE_HASH,
        dstExecTxHash: '0xexec',
      });
    });

    it('handles partial object input', () => {
      const handle = { l2SrcTxHash: TX_HASH };
      const result = resolveIdsFromWaitable(handle as any);
      expect(result.l2SrcTxHash).toBe(TX_HASH);
      expect(result.bundleHash).toBeUndefined();
    });
  });

  describe('isL1MessageSentLog', () => {
    it('returns true for matching L1MessageSent log', () => {
      const log: Log = {
        address: L1_MESSENGER_ADDRESS,
        topics: [TOPIC_L1_MESSAGE_SENT_LEG],
        data: '0x',
        transactionHash: TX_HASH,
      };
      expect(isL1MessageSentLog(log)).toBe(true);
    });

    it('returns true for case-insensitive address match', () => {
      const log: Log = {
        address: L1_MESSENGER_ADDRESS.toLowerCase() as Address,
        topics: [TOPIC_L1_MESSAGE_SENT_LEG.toUpperCase() as Hex],
        data: '0x',
        transactionHash: TX_HASH,
      };
      expect(isL1MessageSentLog(log)).toBe(true);
    });

    it('returns false for non-matching address', () => {
      const log: Log = {
        address: '0x0000000000000000000000000000000000001234' as Address,
        topics: [TOPIC_L1_MESSAGE_SENT_LEG],
        data: '0x',
        transactionHash: TX_HASH,
      };
      expect(isL1MessageSentLog(log)).toBe(false);
    });

    it('returns false for non-matching topic', () => {
      const log: Log = {
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
          decodeInteropBundleSent: () => ({
            bundleHash: BUNDLE_HASH,
            sourceChainId: 1n,
            destinationChainId: 2n,
          }),
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

  describe('extractGwBlockNumber', () => {
    it('extracts GW block number', () => {
      const proofs = [
        '0x010f040000000000000000000000000000000000000000000000000000000000',
        '0x72abee45b59e344af8a6e520241c4744aff26ed411f4c4b00f8af09adada43ba',
        '0xc3d03eebfd83049991ea3d3e358b6712e7aa2e2e63dc2d4b438987cec28ac8d0',
        '0xe3697c7f33c31a9b0f0aeb8542287d0d21e8c4cf82163d0c44c7a98aa11aa111',
        '0x199cc5812543ddceeddd0fc82807646a4899444240db2c0d2f20c3cceb5f51fa',
        '0xe4733f281f18ba3ea8775dd62d2fcd84011c8c938f16ea5790fd29a03bf8db89',
        '0x1798a1fd9c8fbb818c98cff190daa7cc10b6e5ac9716b4a2649f7c2ebcef2272',
        '0x66d7c5983afe44cf15ea8cf565b34c6c31ff0cb4dd744524f7842b942d08770d',
        '0xb04e5ee349086985f74b73971ce9dfe76bbed95c84906c5dffd96504e1e5396c',
        '0xac506ecb5465659b3a927143f6d724f91d8d9c4bdb2463aee111d9aa869874db',
        '0x124b05ec272cecd7538fdafe53b6628d31188ffb6f345139aac3c3c1fd2e470f',
        '0xc3be9cbd19304d84cca3d045e06b8db3acd68c304fc9cd4cbffe6d18036cb13f',
        '0xfef7bd9f889811e59e4076a0174087135f080177302763019adaf531257e3a87',
        '0xa707d1c62d8be699d34cb74804fdd7b4c568b6c1a821066f126c680d4b83e00b',
        '0xf6e093070e0389d2e529d60fadb855fdded54976ec50ac709e3a36ceaa64c291',
        '0xff84f4b0eb3607f9bbcf0d6070ae0037ae6efdcc4ee53bf65fe39b8bc8bd83dc',
        '0x000000000000000000000000000000000000000000000000000000000000000e',
        '0x46700b4d40ac5c35af2c22dda2787a91eb567b06c924a8fb8ae9a05b20c08c21',
        '0x89e74aa99931d43347c39591f05b8b355bb38360d7c25735b3aab1abe4af84c8',
        '0x4070814be0fdb6910ec9fad70042d1c4ce51ecbaf4b884bbd9a919632e997e74',
        '0xae7e6913893dae1372162e55adea7fd8ea22d52f7a8a4c85471afd78d8cac7d1',
        '0x0000000000000000000000000000004200000000000000000000000000000001',
        '0x00000000000000000000000000000000000000000000000000000000000001fa',
        '0x0102000100000000000000000000000000000000000000000000000000000000',
        '0xf84927dc03d95cc652990ba75874891ccc5a4d79a0e10a2ffdd238a34a39f828',
        '0xaec5f423d6f2bef743837da97ee98fcbd7c210ea938510515ed60e65e781ab90',
      ] as Hex[];
      const blockNumber = extractGwBlockNumber(proofs);
      expect(blockNumber).toBe(66n);
    });
  });
});
