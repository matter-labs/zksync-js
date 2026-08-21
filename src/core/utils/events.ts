// src/core/utils/events.ts
import {
  L1_MESSENGER_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  TOPIC_L1_MESSAGE_SENT_NEW,
  TOPIC_L1_MESSAGE_SENT_LEG,
} from '../constants';
import type { Log, TxReceipt } from '../types/transactions';
import type { Address } from '../types/primitives';

type Prefer = 'messenger' | 'assetRouter' | { address: string };

function extractPreferAddress(opts?: { prefer?: Prefer }): string {
  const preferAddr =
    typeof opts?.prefer === 'object'
      ? opts.prefer.address
      : opts?.prefer === 'assetRouter'
        ? L2_ASSET_ROUTER_ADDRESS
        : L1_MESSENGER_ADDRESS;

  return (preferAddr || L1_MESSENGER_ADDRESS).toLowerCase();
}

// Finds the L1MessageSent log in an L2 transaction receipt.
// If multiple are found, uses opts to determine which to return.
// By default, prefers the messenger address; otherwise uses the user-specified index.
export function findL1MessageSentLog(
  receipt: TxReceipt,
  opts?: { prefer?: Prefer; index?: number },
): Log {
  const index = opts?.index ?? 0;

  // Choose which address we prefer when multiple logs match
  const preferAddr = extractPreferAddress(opts);

  const matches = receipt.logs.filter((lg) => {
    const t0 = (lg.topics?.[0] ?? '').toLowerCase();
    return t0 === TOPIC_L1_MESSAGE_SENT_NEW || t0 === TOPIC_L1_MESSAGE_SENT_LEG;
  });

  if (!matches.length) {
    throw new Error('No L1MessageSent event found in L2 receipt logs.');
  }

  // Prefer the chosen address; otherwise take the user-specified index (legacy behavior)
  const preferred = matches.find((lg) => (lg.address ?? '').toLowerCase() === preferAddr);
  const chosen = preferred ?? matches[index] ?? matches[0];
  if (!chosen) {
    throw new Error('No suitable L1MessageSent event found.');
  }
  return chosen;
}

export function isL1MessageSentLog(log: Log, opts?: { prefer?: Prefer }): boolean {
  const topic = log.topics[0].toLowerCase();
  const preferAddr = extractPreferAddress(opts);
  return (
    log.address.toLowerCase() === preferAddr &&
    (topic === TOPIC_L1_MESSAGE_SENT_LEG.toLowerCase() ||
      topic === TOPIC_L1_MESSAGE_SENT_NEW.toLowerCase())
  );
}

const SENDER_TOPIC = /^0x0{24}([0-9a-fA-F]{40})$/;

// Not the L2 tx `to`, which is the initiating contract for an onchain-triggered withdrawal.
export function l1MessageSentSender(log: Log): Address {
  const sender = SENDER_TOPIC.exec(log.topics?.[1] ?? '')?.[1];
  if (!sender) {
    throw new Error('L1MessageSent log has no valid sender topic.');
  }
  return `0x${sender.toLowerCase()}`;
}
