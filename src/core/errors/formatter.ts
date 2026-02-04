// src/core/errors/formatter.ts

/* -------------------- Formatting helpers -------------------- */
import type { ErrorEnvelope } from '../types';
import { isBigint, isNumber } from '../utils';

function elideMiddle(s: string, max = 96): string {
  if (s.length <= max) return s;
  const keep = Math.max(10, Math.floor((max - 1) / 2));
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

function shortJSON(v: unknown, max = 240): string {
  try {
    const s = JSON.stringify(v, (_k: string, val: unknown): unknown =>
      isBigint(val) ? `${val.toString()}n` : val,
    );
    return s.length > max ? elideMiddle(s, max) : s;
  } catch {
    return String(v);
  }
}

function kv(label: string, value: string): string {
  const width = 10;
  const pad = label.length >= width ? ' ' : ' '.repeat(width - label.length);
  return `${label + pad}: ${value}`;
}

function formatContextLine(ctx?: Record<string, unknown>): string | undefined {
  if (!ctx) return;
  const txHash = ctx['txHash'] ?? ctx['l1TxHash'] ?? ctx['hash'];
  const nonce = ctx['nonce'];
  const parts: string[] = [];

  if (txHash !== undefined)
    parts.push(`txHash=${typeof txHash === 'string' ? txHash : shortJSON(txHash, 96)}`);
  if (nonce !== undefined) {
    const nonceStr =
      typeof nonce === 'string' || isNumber(nonce) || isBigint(nonce)
        ? String(nonce)
        : shortJSON(nonce, 48);
    parts.push(`nonce=${nonceStr}`);
  }
  return parts.length ? `  ${kv('Context', parts.join('  •  '))}` : undefined;
}

function formatStep(ctx?: Record<string, unknown>): string | undefined {
  const step = ctx && typeof ctx['step'] === 'string' ? ctx['step'] : undefined;
  return step ? `  ${kv('Step', step)}` : undefined;
}

function formatRevert(r?: ErrorEnvelope['revert']): string | undefined {
  if (!r) return;
  const first = [`selector=${r.selector}`];
  const lines: string[] = [];
  lines.push(`  ${kv('Revert', first.join(' '))}`);
  if (r.name) lines.push(`              name=${r.name}`);
  if (r.contract) lines.push(`              contract=${r.contract}`);
  if (r.fn) lines.push(`              fn=${r.fn}`);
  if (r.args && r.args.length) {
    lines.push(`              args=${shortJSON(r.args, 120)}`);
  }
  return lines.join('\n');
}

function formatCause(c?: unknown): string[] {
  if (!c) return [];
  const out: string[] = [];

  // If the cause is an object, read known fields safely; otherwise stringify it.
  if (typeof c === 'object' && c !== null) {
    const obj = c as Record<string, unknown>;
    const head: string[] = [];
    if (obj.name !== undefined) {
      const nameVal = obj.name;
      const nameStr =
        typeof nameVal === 'string' ||
        isNumber(nameVal) ||
        isBigint(nameVal) ||
        typeof nameVal === 'boolean'
          ? String(nameVal)
          : shortJSON(nameVal, 120);
      head.push(`name=${nameStr}`);
    }
    if (obj.code !== undefined) {
      const codeVal = obj.code;
      const codeStr =
        typeof codeVal === 'string' ||
        isNumber(codeVal) ||
        isBigint(codeVal) ||
        typeof codeVal === 'boolean'
          ? String(codeVal)
          : shortJSON(codeVal, 120);
      head.push(`code=${codeStr}`);
    }
    if (head.length) out.push(`  ${kv('Cause', head.join('  '))}`);

    if (obj.message) {
      const messageStr =
        typeof obj.message === 'string' ||
        isNumber(obj.message) ||
        isBigint(obj.message) ||
        typeof obj.message === 'boolean'
          ? String(obj.message)
          : shortJSON(obj.message, 600);
      out.push(`              message=${elideMiddle(messageStr, 600)}`);
    }
    if (obj.data) {
      const dataStr = shortJSON(obj.data, 200);
      out.push(`              data=${elideMiddle(dataStr, 200)}`);
    }
  } else {
    out.push(`  ${kv('Cause', shortJSON(c, 200))}`);
  }

  return out;
}

export function formatEnvelopePretty(e: ErrorEnvelope): string {
  const lines: string[] = [];

  // Header
  lines.push(`✖ ZKsyncError [${e.type}]`);
  lines.push(`  ${kv('Message', e.message)}`);
  lines.push('');

  lines.push(`  ${kv('Operation', e.operation)}`);

  const ctx = (() => {
    const u = e as unknown;
    if (!u || typeof u !== 'object') return undefined;
    const obj = u as Record<string, unknown>;
    const candidate = obj['ctx'] ?? obj['context'];
    if (candidate && typeof candidate === 'object' && candidate !== null) {
      return candidate as Record<string, unknown>;
    }
    return undefined;
  })();

  const ctxLine = formatContextLine(ctx);
  if (ctxLine) lines.push(ctxLine);

  const stepLine = formatStep(ctx);
  if (stepLine) lines.push(stepLine);

  const rv = formatRevert(e.revert);
  if (rv) lines.push(rv);

  const causeLines = formatCause(e.cause);
  if (causeLines.length) {
    if (!ctxLine && !rv) lines.push('');
    lines.push(...causeLines);
  }

  return lines.join('\n');
}
