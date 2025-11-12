/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type { Abi } from 'viem';
import { decodeErrorResult } from 'viem';

import {
  IL1NullifierABI,
  L2NativeTokenVaultABI,
  L1NativeTokenVaultABI,
  MailboxABI,
  IERC20ABI,
} from '../../../core/internal/abi-registry';

import { REVERT_TO_READINESS } from '../../../core/errors/withdrawal-revert-map';
import type { FinalizeReadiness } from '../../../core/types/flows/withdrawals';
import type { Address } from '../../../core/types';

// TODO: refactor as lots of duplication here

export interface DecodedRevert {
  /** 4-byte selector, always present if this is a revert */
  selector: `0x${string}`;
  /** Decoded Solidity error name */
  name?: string;
  /** Decoded args (already JS-decoded) */
  args?: unknown[];
  /** Optional labels if we know the contract/function context */
  contract?: string;
  /** Function name if known */
  fn?: string;
}

/**
 * Minimal registry of ABIs for decoding custom errors.
 */
const ERROR_ABIS: { name: string; abi: Abi }[] = [];
const ABI_ERROR_STRING: Abi = [
  { type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] },
];
const ABI_PANIC: Abi = [
  { type: 'error', name: 'Panic', inputs: [{ name: 'code', type: 'uint256' }] },
];

(function bootstrapDefaultAbis() {
  try {
    ERROR_ABIS.push({ name: 'IL1Nullifier', abi: IL1NullifierABI as unknown as Abi });
  } catch {
    // ignore
  }
  try {
    ERROR_ABIS.push({ name: 'IERC20', abi: IERC20ABI as unknown as Abi });
  } catch {
    // ignore
  }
  try {
    ERROR_ABIS.push({ name: 'IL1NativeTokenVault', abi: L1NativeTokenVaultABI as unknown as Abi });
  } catch {
    // ignore
  }
  try {
    ERROR_ABIS.push({ name: 'IL2NativeTokenVault', abi: L2NativeTokenVaultABI as unknown as Abi });
  } catch {
    // ignore
  }
  try {
    ERROR_ABIS.push({ name: 'Mailbox', abi: MailboxABI as unknown as Abi });
  } catch {
    // ignore
  }
})();

/** Allow callers to extend the error-decode registry at runtime. */
export function registerErrorAbi(name: string, abi: Abi) {
  const i = ERROR_ABIS.findIndex((x) => x.name === name);
  const entry = { name, abi };
  if (i >= 0) ERROR_ABIS[i] = entry;
  else ERROR_ABIS.push(entry);
}

// TODO: fixme
/** Extract `0x` revert data from common Viem shapes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractRevertData(e: any): `0x${string}` | undefined {
  // Viem BaseError often nests under cause(s)
  // Try a few common spots conservatively.
  const candidates = [
    e?.data?.data,
    e?.error?.data,
    e?.data,
    e?.error?.error?.data,
    e?.info?.error?.data,
    e?.cause?.data,
    e?.cause?.cause?.data,
    e?.details,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('0x') && c.length >= 10) {
      return c as `0x${string}`;
    }
  }
  return undefined;
}

/**
 * Decodes revert using:
 * 1) built-ins (Error(string), Panic(uint256))
 * 2) registered ABIs (custom errors)
 * Returns `undefined` if no revert data was found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decodeRevert(e: any): DecodedRevert | undefined {
  const data = extractRevertData(e);
  if (!data) return;

  const selector: Address = `0x${data.slice(2, 10)}`;

  // Try built-ins first
  try {
    const parsed = decodeErrorResult({ abi: ABI_ERROR_STRING, data });
    if (parsed?.errorName === 'Error') {
      return { selector, name: parsed.errorName, args: parsed.args ? [...parsed.args] : undefined };
    }
  } catch {
    // ignore
  }
  try {
    const parsed = decodeErrorResult({ abi: ABI_PANIC, data });
    if (parsed?.errorName === 'Panic') {
      return { selector, name: parsed.errorName, args: parsed.args ? [...parsed.args] : undefined };
    }
  } catch {
    // ignore
  }

  // Try all registered ABIs
  for (const { name, abi } of ERROR_ABIS) {
    try {
      const parsed = decodeErrorResult({ abi, data });
      if (parsed && parsed.errorName) {
        return {
          selector,
          name: parsed.errorName,
          args: parsed.args ? [...parsed.args] : undefined,
          contract: name,
        };
      }
    } catch {
      // keep trying
    }
  }

  // Fallback with selector only
  return { selector };
}

/** Classify finalizeDeposit readiness from revert error . */
export function classifyReadinessFromRevert(e: unknown): FinalizeReadiness {
  const r = decodeRevert(e);
  const name = r?.name;

  if (name && REVERT_TO_READINESS[name]) return REVERT_TO_READINESS[name];

  const msg = (() => {
    if (typeof e !== 'object' || e === null) return '';
    const obj = e as Record<string, unknown>;
    const maybe = obj['shortMessage'] ?? obj['message'];
    return typeof maybe === 'string' ? maybe : '';
  })();
  const lower = msg.toLowerCase();
  if (lower.includes('paused')) return { kind: 'NOT_READY', reason: 'paused' };

  if (name || r?.selector) {
    return { kind: 'UNFINALIZABLE', reason: 'unsupported', detail: name ?? r?.selector };
  }

  return { kind: 'NOT_READY', reason: 'unknown', detail: lower || undefined };
}
