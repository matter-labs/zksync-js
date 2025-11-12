/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect } from 'bun:test';
import { findL1MessageSentLog } from '../events';
import {
  L1_MESSENGER_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  TOPIC_L1_MESSAGE_SENT_NEW,
  TOPIC_L1_MESSAGE_SENT_LEG,
} from '../../../constants';
import { ParsedReceipt } from '../../../types/flows/withdrawals';

type LogLike = { address?: string; topics?: string[] };

const log = (addr: string, topic: string): LogLike => ({
  address: addr,
  topics: [topic],
});

// Minimal ParsedReceipt
const receipt = (logs: LogLike[]) => ({ logs }) as any;

describe('withdrawals/findL1MessageSentLog', () => {
  it('picks the messenger log by default when multiple logs match', () => {
    const r = receipt([
      log(L2_ASSET_ROUTER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW),
      log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW),
    ]);
    const chosen = findL1MessageSentLog(r as ParsedReceipt);
    expect(chosen.address?.toLowerCase()).toBe(L1_MESSENGER_ADDRESS.toLowerCase());
  });

  it('accepts legacy topic as well', () => {
    const r = receipt([log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_LEG)]);
    const chosen = findL1MessageSentLog(r as ParsedReceipt);
    expect(chosen.address?.toLowerCase()).toBe(L1_MESSENGER_ADDRESS.toLowerCase());
  });

  it("respects prefer='assetRouter'", () => {
    const r = receipt([
      log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW),
      log(L2_ASSET_ROUTER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW),
    ]);
    const chosen = findL1MessageSentLog(r as ParsedReceipt, { prefer: 'assetRouter' });
    expect(chosen.address?.toLowerCase()).toBe(L2_ASSET_ROUTER_ADDRESS.toLowerCase());
  });

  it('respects prefer={ address } with mixed-case & 0X prefix', () => {
    const custom = '0XabcDEFabcDEFabcDEFabcDEFabcDEFabcDEFab';
    const r = receipt([
      log(L1_MESSENGER_ADDRESS, TOPIC_L1_MESSAGE_SENT_NEW),
      log(custom, TOPIC_L1_MESSAGE_SENT_NEW),
    ]);
    const chosen = findL1MessageSentLog(r as ParsedReceipt, { prefer: { address: custom } });
    expect(chosen.address?.toLowerCase()).toBe(custom.toLowerCase());
  });

  it('falls back to the provided index when preferred address not present', () => {
    const r = receipt([
      log('0x1111111111111111111111111111111111111111', TOPIC_L1_MESSAGE_SENT_NEW),
      log('0x2222222222222222222222222222222222222222', TOPIC_L1_MESSAGE_SENT_NEW),
    ]);
    const chosen = findL1MessageSentLog(r as ParsedReceipt, { prefer: 'messenger', index: 1 });
    expect(chosen.address?.toLowerCase()).toBe('0x2222222222222222222222222222222222222222');
  });

  it('throws when no matching topics are present', () => {
    const r = receipt([
      { address: L1_MESSENGER_ADDRESS, topics: ['0xdeadbeef'] },
      { address: L2_ASSET_ROUTER_ADDRESS, topics: ['0xfeedface'] },
    ]);
    expect(() => findL1MessageSentLog(r as ParsedReceipt)).toThrow(
      /No L1MessageSent event found in L2 receipt logs/,
    );
  });

  it('defensive: returns first match if index out of range and no preferred address', () => {
    const r = receipt([
      log('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', TOPIC_L1_MESSAGE_SENT_NEW),
    ]);
    const chosen = findL1MessageSentLog(r as ParsedReceipt, {
      prefer: { address: '0xnope' },
      index: 5,
    });
    expect(chosen.address?.toLowerCase()).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
});
