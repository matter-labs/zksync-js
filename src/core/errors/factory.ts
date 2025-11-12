// src/core/errors/factory.ts
import { ZKsyncError, type ErrorEnvelope, type ErrorType } from '../types/errors';

/** Creates a ZKsyncError of the specified type, with the provided details. */
export function createError(type: ErrorType, input: Omit<ErrorEnvelope, 'type'>): ZKsyncError {
  return new ZKsyncError({ ...input, type });
}

/** Extracts and shapes the cause of an error into a standardized format. */
export function shapeCause(err: unknown) {
  const isRecord = (x: unknown): x is Record<string, unknown> =>
    x !== null && typeof x === 'object';

  let data: unknown = undefined;
  if (isRecord(err)) {
    const r = err;
    const d = r.data;
    if (isRecord(d) && 'data' in d) {
      data = d.data;
    } else if ('error' in r && isRecord(r.error) && 'data' in r.error) {
      data = r.error.data;
    } else if ('data' in r) {
      data = r.data;
    }
  }

  const r = isRecord(err) ? err : undefined;

  const name = r && typeof r.name === 'string' ? r.name : undefined;
  const message =
    r && typeof r.message === 'string'
      ? r.message
      : r && typeof r.shortMessage === 'string'
        ? r.shortMessage
        : undefined;
  const code = r && 'code' in r ? r.code : undefined;

  return {
    name,
    message,
    code,
    data: typeof data === 'string' && data.startsWith('0x') ? `${data.slice(0, 10)}…` : undefined,
  };
}
