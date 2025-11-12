// src/core/withdrawals/events.ts
import {
  L1_MESSENGER_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  TOPIC_L1_MESSAGE_SENT_NEW,
  TOPIC_L1_MESSAGE_SENT_LEG,
} from '../../constants';
import type { ParsedLog, ParsedReceipt } from '../../types/flows/withdrawals';

type Prefer = 'messenger' | 'assetRouter' | { address: string };

// Finds the L1MessageSent log in an L2 transaction receipt.
// If multiple are found, uses opts to determine which to return.
// By default, prefers the messenger address; otherwise uses the user-specified index.
export function findL1MessageSentLog(
  receipt: ParsedReceipt,
  opts?: { prefer?: Prefer; index?: number },
): ParsedLog {
  const index = opts?.index ?? 0;

  // Choose which address we prefer when multiple logs match
  const preferAddr =
    typeof opts?.prefer === 'object'
      ? opts?.prefer.address
      : opts?.prefer === 'assetRouter'
        ? L2_ASSET_ROUTER_ADDRESS
        : L1_MESSENGER_ADDRESS;

  const prefer = (preferAddr ?? L1_MESSENGER_ADDRESS).toLowerCase();

  const matches = receipt.logs.filter((lg) => {
    const t0 = (lg.topics?.[0] ?? '').toLowerCase();
    return t0 === TOPIC_L1_MESSAGE_SENT_NEW || t0 === TOPIC_L1_MESSAGE_SENT_LEG;
  });

  if (!matches.length) {
    throw new Error('No L1MessageSent event found in L2 receipt logs.');
  }

  // Prefer the chosen address; otherwise take the user-specified index (legacy behavior)
  const preferred = matches.find((lg) => (lg.address ?? '').toLowerCase() === prefer);
  const chosen = preferred ?? matches[index] ?? matches[0];
  if (!chosen) {
    throw new Error('No suitable L1MessageSent event found.');
  }
  return chosen;
}
