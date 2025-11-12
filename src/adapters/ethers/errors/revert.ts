import { Interface, type JsonFragment } from 'ethers';
import { REVERT_TO_READINESS } from '../../../core/errors/withdrawal-revert-map';
import type { FinalizeReadiness } from '../../../core/types/flows/withdrawals';
import type { Address } from '../../../core/types';

import {
  IL1NullifierABI,
  L2NativeTokenVaultABI,
  L1NativeTokenVaultABI,
  MailboxABI,
  IERC20ABI,
} from '../../../core/internal/abi-registry';

// TODO: refactor as lots of duplication here
export interface DecodedRevert {
  /** 4-byte selector, always present if this is a revert */
  selector: `0x${string}`;
  /** Decoded Solidity error name */
  name?: string;
  /** Decoded args from parseError */
  args?: unknown[];
  /** Optional labels if we know the contract/function context */
  contract?: string;
  /** Function name if known */
  fn?: string;
}

/**
 * Minimal registry of Interfaces for decode.
 */
const ERROR_IFACES: { name: string; iface: Interface }[] = [];
const IFACE_ERROR_STRING = new Interface(['error Error(string)']);
const IFACE_PANIC = new Interface(['error Panic(uint256)']);

(function bootstrapDefaultIfaces() {
  try {
    ERROR_IFACES.push({
      name: 'IL1Nullifier',
      iface: new Interface(IL1NullifierABI),
    });
  } catch {
    // ignore
  }
  try {
    ERROR_IFACES.push({ name: 'IERC20', iface: new Interface(IERC20ABI) });
  } catch {
    // ignore
  }
  try {
    ERROR_IFACES.push({
      name: 'IL1NativeTokenVault',
      iface: new Interface(L1NativeTokenVaultABI),
    });
  } catch {
    // ignore
  }
  try {
    ERROR_IFACES.push({
      name: 'IL2NativeTokenVault',
      iface: new Interface(L2NativeTokenVaultABI),
    });
  } catch {
    // ignore
  }
  try {
    ERROR_IFACES.push({ name: 'Mailbox', iface: new Interface(MailboxABI) });
  } catch {
    // ignore
  }
})();

/**
 * Allow callers to extend the error-decode registry at runtime.
 * Example: registerErrorAbi('MyContract', MyContractABI);
 */
export function registerErrorAbi(name: string, abi: ReadonlyArray<JsonFragment>) {
  const existing = ERROR_IFACES.findIndex((x) => x.name === name);
  const entry = { name, iface: new Interface(abi as JsonFragment[]) };
  if (existing >= 0) ERROR_IFACES[existing] = entry;
  else ERROR_IFACES.push(entry);
}

/**
 * Extract revert data.
 */
// TODO: fixme
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractRevertData(e: any): string | undefined {
  // TODO: support nested custom errors?
  // Can be simplfiied
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const maybe =
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    e?.data?.data ?? e?.error?.data ?? e?.data ?? e?.error?.error?.data ?? e?.info?.error?.data;

  if (typeof maybe === 'string' && maybe.startsWith('0x') && maybe.length >= 10) {
    return maybe;
  }
  return undefined;
}

/**
 * Zero-arg decoder: tries standard Error(string)/Panic(uint256) first,
 * then all registered Interfaces (IL1Nullifier, IERC20, etc.).
 *
 * Returns `undefined` if no revert data detected. Otherwise returns at least { selector }.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decodeRevert(e: any): DecodedRevert | undefined {
  const data = extractRevertData(e);
  if (!data) return;
  const selector: Address = `0x${data.slice(2, 10)}`;

  // Try Error(string)
  try {
    const parsed = IFACE_ERROR_STRING.parseError(data);
    if (parsed?.name === 'Error') {
      const args = parsed.args ? Array.from(parsed.args) : undefined;
      return { selector, name: 'Error', args };
    }
  } catch {
    // keep trying
  }

  // Try Panic(uint256)
  try {
    const parsed = IFACE_PANIC.parseError(data);
    if (parsed?.name === 'Panic') {
      const args = parsed.args ? Array.from(parsed.args) : undefined;
      return { selector, name: 'Panic', args };
    }
  } catch {
    // keep trying
  }

  // Try all registered ABIs
  for (const { name, iface } of ERROR_IFACES) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) {
        const args = parsed.args ? Array.from(parsed.args) : undefined;
        return {
          selector,
          name: parsed.name,
          args,
          contract: name,
        };
      }
    } catch {
      // keep trying
    }
  }

  // Fallback
  return { selector };
}

/** Classify finalizeDeposit readiness from revert error. */
export function classifyReadinessFromRevert(e: unknown): FinalizeReadiness {
  const r = decodeRevert(e);
  const name = r?.name;

  if (name && REVERT_TO_READINESS[name]) return REVERT_TO_READINESS[name];

  const msg = (() => {
    if (typeof e !== 'object' || e === null) return '';
    const obj = e as Record<string, unknown>;
    const maybeMsg = obj['shortMessage'] ?? obj['message'];
    return typeof maybeMsg === 'string' ? maybeMsg : '';
  })();
  const lower = String(msg).toLowerCase();
  if (lower.includes('paused')) return { kind: 'NOT_READY', reason: 'paused' };

  if (name || r?.selector) {
    return { kind: 'UNFINALIZABLE', reason: 'unsupported', detail: name ?? r?.selector };
  }

  // Fallback
  return { kind: 'NOT_READY', reason: 'unknown', detail: lower || undefined };
}
