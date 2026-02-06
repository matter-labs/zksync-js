// src/core/types/errors.ts

import { formatEnvelopePretty } from '../errors/formatter';

// TODO: revisit safeInspect implementation
const hasSymbolInspect = typeof Symbol === 'function' && typeof Symbol.for === 'function';
const kInspect: symbol | undefined = hasSymbolInspect
  ? Symbol.for('nodejs.util.inspect.custom')
  : undefined;

function safeInspect(val: unknown): string {
  try {
    if (typeof val === 'string') return val;
    return JSON.stringify(val, null, 2);
  } catch {
    try {
      return String(val);
    } catch {
      return Object.prototype.toString.call(val);
    }
  }
}

// TODO: revisit these types
export type ErrorType =
  | 'VALIDATION'
  | 'STATE'
  | 'EXECUTION'
  | 'RPC'
  | 'INTERNAL'
  | 'VERIFICATION'
  | 'CONTRACT'
  | 'TIMEOUT';

/** Resource surface */
export type Resource =
  | 'deposits'
  | 'withdrawals'
  | 'withdrawal-finalization'
  | 'interop'
  | 'tokens'
  | 'contracts'
  | 'helpers'
  | 'zksrpc'
  | 'client';

/** Envelope we throw only for SDK-domain errors. */
export interface ErrorEnvelope {
  /** Resource surface that raised the error. */
  resource: Resource;
  /** SDK operation, e.g. 'withdrawals.finalize' */
  operation: string;
  /** Broad category */
  type: ErrorType;
  /** Human-readable, stable message for developers. */
  message: string;

  /** Optional detail that adapters may enrich (reverts, extra context) */
  context?: Record<string, unknown>;

  /** If the error is a contract revert, adapters add decoded info here. */
  revert?: {
    /** 4-byte selector as 0x…8 hex */
    selector: `0x${string}`;
    /** Decoded error name when available (e.g. 'InvalidProof') */
    name?: string;
    /** Decoded args (ethers/viem output), when available */
    args?: unknown[];
    /** Optional adapter-known labels */
    contract?: string;
    /** Optional adapter-known function name */
    fn?: string;
  };

  /** Original thrown error  */
  cause?: unknown;
}

/** Error class.
 * Represents an error that occurs within the ZKsync SDK.
 * It encapsulates an ErrorEnvelope which provides detailed information about the error,
 *
 */
export class ZKsyncError extends Error {
  constructor(public readonly envelope: ErrorEnvelope) {
    super(formatEnvelopePretty(envelope), envelope.cause ? { cause: envelope.cause } : undefined);
    this.name = 'ZKsyncError';
  }

  toJSON() {
    return { name: this.name, ...this.envelope };
  }
}

// TODO: revisit kInspect usage
if (kInspect) {
  Object.defineProperty(ZKsyncError.prototype, kInspect, {
    value(this: ZKsyncError) {
      return `${this.name}: ${formatEnvelopePretty(this.envelope)}`;
    },
    enumerable: false,
  });
}

//  ---- Factory & type guards ----
export function isZKsyncError(e: unknown): e is ZKsyncError {
  if (!e || typeof e !== 'object') return false;

  const maybe = e as { envelope?: unknown };
  if (!('envelope' in maybe)) return false;

  const envelope = maybe.envelope as Record<string, unknown> | undefined;
  return typeof envelope?.type === 'string' && typeof envelope?.message === 'string';
}

// "receipt not found" detector across viem / ethers / generic RPC.
export function isReceiptNotFound(e: unknown): boolean {
  type ReceiptErrorNode = {
    name?: string;
    code?: string | number;
    shortMessage?: string;
    message?: string;
    cause?: unknown;
  };
  const chain: ReceiptErrorNode[] = [];
  let cur: ReceiptErrorNode | undefined = e as ReceiptErrorNode | undefined;
  for (let i = 0; i < 5 && cur; i++) {
    chain.push(cur);
    cur = cur.cause as ReceiptErrorNode | undefined;
  }

  // Known names/labels
  const NAME_HITS = new Set([
    'TransactionReceiptNotFoundError', // viem
    'TransactionNotFoundError', // viem
    'NotFoundError', // some RPC wrappers
  ]);

  const CODE_HITS = new Set([
    'TRANSACTION_NOT_FOUND', // some ethers-ish shapes / providers
    'RECEIPT_NOT_FOUND',
    'NOT_FOUND',
    -32000, // JSON-RPC server error
  ]);

  // Message regex fallback
  const MSG_RE = /(transaction|receipt)[^]*?(not\s+(?:be\s+)?found|missing)/i;

  for (const node of chain) {
    const name = node?.name;
    const code = node?.code;
    const short = node?.shortMessage;
    const msg = String(short ?? node?.message ?? '');

    if (name && NAME_HITS.has(name)) return true;
    if (code && CODE_HITS.has(code)) return true;
    if (MSG_RE.test(msg)) return true;
  }

  // Final fallback: inspect the original error text
  const raw = (() => {
    const node = e as ReceiptErrorNode | undefined;
    const short = node?.shortMessage;
    const msg = node?.message;
    if (typeof short === 'string' && short) return short;
    if (typeof msg === 'string' && msg) return msg;
    if (e == null) return '';
    if (typeof e === 'string') return e;
    return safeInspect(e);
  })();
  return MSG_RE.test(raw);
}

// TryResult type for operations that can fail without throwing
export type TryResult<T> = { ok: true; value: T } | { ok: false; error: ZKsyncError };

export const OP_CLIENT = {
  ensureAddresses: 'client.ensureAddresses',
} as const;

// Operation constants for Deposit error contexts
export const OP_DEPOSITS = {
  // high-level flow ops
  quote: 'deposits.quote',
  tryQuote: 'deposits.tryQuote',
  prepare: 'deposits.prepare',
  tryPrepare: 'deposits.tryPrepare',
  create: 'deposits.create',
  tryCreate: 'deposits.tryCreate',
  status: 'deposits.status',
  wait: 'deposits.wait',
  tryWait: 'deposits.tryWait',
  base: {
    assertErc20Asset: 'deposits.erc20-base:assertErc20Asset',
    assertMatchesBase: 'deposits.erc20-base:assertMatchesBase',
    baseToken: 'deposits.erc20-base:baseToken',
    allowance: 'deposits.erc20-base:allowance',
    baseCost: 'deposits.erc20-base:l2TransactionBaseCost',
    estGas: 'deposits.erc20-base:estimateGas',
  },
  nonbase: {
    baseToken: 'deposits.erc20-nonbase:baseToken',
    assertNotEthAsset: 'deposits.erc20-nonbase:assertNotEthAsset',
    allowance: 'deposits.erc20-nonbase:allowance',
    allowanceFees: 'deposits.erc20-nonbase:allowanceFeesBaseToken',
    baseCost: 'deposits.erc20-nonbase:l2TransactionBaseCost',
    encodeCalldata: 'deposits.erc20-nonbase:encodeSecondBridgeErc20Args',
    estGas: 'deposits.erc20-nonbase:estimateGas',
    assertBaseIsEth: 'deposits.erc20-nonbase:assertBaseIsEth',
    assertBaseIsErc20: 'deposits.erc20-nonbase:assertBaseIsErc20',
    assertNonBaseToken: 'deposits.erc20-nonbase:assertNonBaseToken',
    allowanceToken: 'deposits.erc20-nonbase:allowanceToken',
    allowanceBase: 'deposits.erc20-nonbase:allowanceBase',
  },
  eth: {
    baseCost: 'deposits.eth:l2TransactionBaseCost',
    estGas: 'deposits.eth:estimateGas',
  },
  ethNonBase: {
    baseToken: 'deposits.eth-nonbase:baseToken',
    baseCost: 'deposits.eth-nonbase:l2TransactionBaseCost',
    allowanceBase: 'deposits.eth-nonbase:allowanceBaseToken',
    ethBalance: 'deposits.eth-nonbase:getEthBalance',
    encodeCalldata: 'deposits.eth-nonbase:encodeSecondBridgeEthArgs',
    estGas: 'deposits.eth-nonbase:estimateGas',
    assertEthAsset: 'deposits.eth-nonbase:assertEthAsset',
    assertNonEthBase: 'deposits.eth-nonbase:assertNonEthBase',
    assertEthBalance: 'deposits.eth-nonbase:assertEthBalance',
  },
} as const;

// Operation constants for Withdrawal error contexts
export const OP_WITHDRAWALS = {
  quote: 'withdrawals.quote',
  tryQuote: 'withdrawals.tryQuote',
  prepare: 'withdrawals.prepare',
  tryPrepare: 'withdrawals.tryPrepare',
  create: 'withdrawals.create',
  tryCreate: 'withdrawals.tryCreate',
  status: 'withdrawals.status',
  wait: 'withdrawals.wait',
  tryWait: 'withdrawals.tryWait',
  erc20: {
    allowance: 'withdrawals.erc20:allowance',
    ensureRegistered: 'withdrawals.erc20:ensureTokenIsRegistered',
    encodeAssetData: 'withdrawals.erc20:encodeAssetData',
    encodeWithdraw: 'withdrawals.erc20:encodeWithdraw',
    estGas: 'withdrawals.erc20:estimateGas',
  },
  eth: {
    encodeWithdraw: 'withdrawals.eth:encodeWithdraw',
    estGas: 'withdrawals.eth:estimateGas',
  },
  ethNonBase: {
    allowance: 'withdrawals.eth-nonbase:allowance',
    ensureRegistered: 'withdrawals.eth-nonbase:ensureTokenIsRegistered',
    encodeAssetData: 'withdrawals.eth-nonbase:encodeAssetData',
    encodeWithdraw: 'withdrawals.eth-nonbase:encodeWithdraw',
    estGas: 'withdrawals.eth-nonbase:estimateGas',
    baseToken: 'withdrawals.eth-nonbase:baseToken',
    assertNonEthBase: 'withdrawals.eth-nonbase:assertNonEthBase',
  },
  finalize: {
    fetchParams: {
      receipt: 'withdrawals.finalize.fetchParams:receipt',
      findMessage: 'withdrawals.finalize.fetchParams:findMessage',
      decodeMessage: 'withdrawals.finalize.fetchParams:decodeMessage',
      rawReceipt: 'withdrawals.finalize.fetchParams:rawReceipt',
      messengerIndex: 'withdrawals.finalize.fetchParams:messengerIndex',
      proof: 'withdrawals.finalize.fetchParams:proof',
      network: 'withdrawals.finalize.fetchParams:network',
    },
    readiness: {
      isFinalized: 'withdrawals.finalize.readiness:isWithdrawalFinalized',
      simulate: 'withdrawals.finalize.readiness:simulate',
    },
    isFinalized: 'withdrawals.finalize.isWithdrawalFinalized',
    send: 'withdrawals.finalize.finalizeDeposit:send',
    wait: 'withdrawals.finalize.finalizeDeposit:wait',
    estimate: 'withdrawals.finalize.estimateFinalizationFees',
  },
} as const;

// Operation constants for Interop error contexts
export const OP_INTEROP = {
  // high-level flow ops (match resource methods)
  quote: 'interop.quote',
  tryQuote: 'interop.tryQuote',
  prepare: 'interop.prepare',
  tryPrepare: 'interop.tryPrepare',
  create: 'interop.create',
  tryCreate: 'interop.tryCreate',
  status: 'interop.status',
  wait: 'interop.wait',
  tryWait: 'interop.tryWait',
  finalize: 'interop.finalize',
  tryFinalize: 'interop.tryFinalize',

  // route-specific ops (keep names aligned with files)
  routes: {
    direct: {
      preflight: 'interop.routes.direct:preflight',
      build: 'interop.routes.direct:build',
    },
    indirect: {
      preflight: 'interop.routes.indirect:preflight',
      build: 'interop.routes.indirect:build',
    },
  },
  // execution path (nonce, gas, send, wait) – mirrors deposits’ style
  exec: {
    sendStep: 'interop.exec:sendStep',
    waitStep: 'interop.exec:waitStep',
  },

  // status service (logs & derivation)
  svc: {
    status: {
      sourceReceipt: 'interop.svc.status:sourceReceipt',
      parseSentLog: 'interop.svc.status:parseSentLog',
      dstLogs: 'interop.svc.status:dstLogs',
      derive: 'interop.svc.status:derive',
      getRoot: 'interop.svc.status:getRoot',
    },
    wait: {
      poll: 'interop.svc.wait:poll',
      timeout: 'interop.svc.wait:timeout',
    },
  },
} as const;
