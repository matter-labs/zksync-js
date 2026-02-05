/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect } from 'bun:test';
import { findL1MessageSentLog, isL1MessageSentLog } from '../events';
import {
  L1_MESSENGER_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  TOPIC_L1_MESSAGE_SENT_NEW,
  TOPIC_L1_MESSAGE_SENT_LEG,
} from '../../constants';
import { TxReceipt } from '../../types/transactions';

type LogLike = { address?: string; topics?: string[]; transactionHash?: string };

const log = (addr: string, topic: string, txHash = '0x' + '00'.repeat(32)): LogLike => ({
  address: addr,
  topics: [topic],
  transactionHash: txHash,
});

// Minimal TxReceipt
const receipt = (logs: LogLike[]) => ({ logs }) as any;

describe('utils/findL1MessageSentLog', () => {
  it('picks the messenger log by default when multiple logs match', () => {
    const r = receipt([
      log(L2_ASSET_ROUTER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW),
      log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW),
    ]);
    const chosen = findL1MessageSentLog(r as TxReceipt);
    expect(chosen.address?.toLowerCase()).toBe(L1_MESSENGER_ADDRESS.toLowerCase());
  });

  it('accepts legacy topic as well', () => {
    const r = receipt([log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_LEG)]);
    const chosen = findL1MessageSentLog(r as TxReceipt);
    expect(chosen.address?.toLowerCase()).toBe(L1_MESSENGER_ADDRESS.toLowerCase());
  });

  it("respects prefer='assetRouter'", () => {
    const r = receipt([
      log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW),
      log(L2_ASSET_ROUTER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW),
    ]);
    const chosen = findL1MessageSentLog(r as TxReceipt, { prefer: 'assetRouter' });
    expect(chosen.address?.toLowerCase()).toBe(L2_ASSET_ROUTER_ADDRESS.toLowerCase());
  });

  it('respects prefer={ address } with mixed-case & 0X prefix', () => {
    const custom = '0XabcDEFabcDEFabcDEFabcDEFabcDEFabcDEFab';
    const r = receipt([
      log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW),
      log(custom, TOPIC_L1_MESSAGE_SENT_NEW),
    ]);
    const chosen = findL1MessageSentLog(r as TxReceipt, { prefer: { address: custom } });
    expect(chosen.address?.toLowerCase()).toBe(custom.toLowerCase());
  });

  it('falls back to the provided index when preferred address not present', () => {
    const r = receipt([
      log('0x1111111111111111111111111111111111111111', TOPIC_L1_MESSAGE_SENT_NEW),
      log('0x2222222222222222222222222222222222222222', TOPIC_L1_MESSAGE_SENT_NEW),
    ]);
    const chosen = findL1MessageSentLog(r as TxReceipt, { prefer: 'messenger', index: 1 });
    expect(chosen.address?.toLowerCase()).toBe('0x2222222222222222222222222222222222222222');
  });

  it('throws when no matching topics are present', () => {
    const r = receipt([
      { address: L1_MESSENGER_ADDRESS, topics: ['0xdeadbeef'] },
      { address: L2_ASSET_ROUTER_ADDRESS, topics: ['0xfeedface'] },
    ]);
    expect(() => findL1MessageSentLog(r as TxReceipt)).toThrow(
      /No L1MessageSent event found in L2 receipt logs/,
    );
  });

  it('defensive: returns first match if index out of range and no preferred address', () => {
    const r = receipt([
      log('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', TOPIC_L1_MESSAGE_SENT_NEW),
    ]);
    const chosen = findL1MessageSentLog(r as TxReceipt, {
      prefer: { address: '0xnope' },
      index: 5,
    });
    expect(chosen.address?.toLowerCase()).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
});

describe('utils/isL1MessageSentLog', () => {
  it('returns true for messenger log with new topic by default', () => {
    const lg = log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW);
    expect(isL1MessageSentLog(lg as any)).toBe(true);
  });

  it('returns true for messenger log with legacy topic by default', () => {
    const lg = log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_LEG);
    expect(isL1MessageSentLog(lg as any)).toBe(true);
  });

  it('returns false when address does not match preferred', () => {
    const lg = log(L2_ASSET_ROUTER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW);
    expect(isL1MessageSentLog(lg as any)).toBe(false);
  });

  it('returns false when topic does not match', () => {
    const lg = log(L1_MESSENGER_ADDRESS, '0xdeadbeef');
    expect(isL1MessageSentLog(lg as any)).toBe(false);
  });

  it('returns true for asset router log when prefer=assetRouter', () => {
    const lg = log(L2_ASSET_ROUTER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW);
    expect(isL1MessageSentLog(lg as any, { prefer: 'assetRouter' })).toBe(true);
  });

  it('returns false for messenger log when prefer=assetRouter', () => {
    const lg = log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW);
    expect(isL1MessageSentLog(lg as any, { prefer: 'assetRouter' })).toBe(false);
  });

  it('returns true for custom address when prefer={ address }', () => {
    const custom = '0xabcdef1234567890123456789012345678901234';
    const lg = log(custom, TOPIC_L1_MESSAGE_SENT_NEW);
    expect(isL1MessageSentLog(lg as any, { prefer: { address: custom } })).toBe(true);
  });

  it('handles case-insensitive address matching', () => {
    const lg = {
      address: L1_MESSENGER_ADDRESS.toUpperCase(),
      topics: [TOPIC_L1_MESSAGE_SENT_NEW.toLowerCase()],
    };
    expect(isL1MessageSentLog(lg as any)).toBe(true);
  });

  it('handles mixed-case custom address in prefer option', () => {
    const custom = '0XabcDEFabcDEFabcDEFabcDEFabcDEFabcDEFab';
    const lg = log(custom.toLowerCase(), TOPIC_L1_MESSAGE_SENT_NEW);
    expect(isL1MessageSentLog(lg as any, { prefer: { address: custom } })).toBe(true);
  });

  it('returns false when both address and topic do not match', () => {
    const lg = log('0x1111111111111111111111111111111111111111', '0xdeadbeef');
    expect(isL1MessageSentLog(lg as any)).toBe(false);
  });
});
