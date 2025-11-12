/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect } from 'bun:test';
import { messengerLogIndex } from '../logs';
import { L1_MESSENGER_ADDRESS } from '../../../constants';
import type { ReceiptWithL2ToL1 } from '../../../rpc/types';

const rcpt = (logs: Array<{ sender: string }>): ReceiptWithL2ToL1 =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ l2ToL1Logs: logs as any }) as ReceiptWithL2ToL1;

describe('withdrawals/messengerLogIndex', () => {
  it('finds index of first messenger log by default', () => {
    const r = rcpt([
      { sender: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { sender: L1_MESSENGER_ADDRESS },
      { sender: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      { sender: L1_MESSENGER_ADDRESS },
    ]);
    const idx = messengerLogIndex(r);
    expect(idx).toBe(1);
  });

  it('supports custom messenger address and returns the specified hit by index', () => {
    const custom = '0x1111111111111111111111111111111111111111';
    const r = rcpt([
      { sender: custom },
      { sender: '0x2222222222222222222222222222222222222222' },
      { sender: custom },
    ]);
    const idx = messengerLogIndex(r, { messenger: custom, index: 1 });
    expect(idx).toBe(2);
  });

  it('is case-insensitive on messenger address', () => {
    const customUpper = '0X3333333333333333333333333333333333333333';
    const r = rcpt([{ sender: customUpper }]);
    const idx = messengerLogIndex(r, { messenger: customUpper.toLowerCase() });
    expect(idx).toBe(0);
  });

  it('throws when there are no messenger logs', () => {
    const r = rcpt([{ sender: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }]);
    expect(() => messengerLogIndex(r)).toThrow(/No L2->L1 messenger logs found/);
  });

  it('defensive: treats missing/invalid l2ToL1Logs as empty and throws', () => {
    const r = { l2ToL1Logs: undefined } as unknown as ReceiptWithL2ToL1;
    expect(() => messengerLogIndex(r)).toThrow(/No L2->L1 messenger logs found/);
  });
});
