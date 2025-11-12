// src/adapters/ethers/errors/error-ops.ts
import { createError, shapeCause } from '../../../core/errors/factory';
import {
  isZKsyncError,
  type TryResult,
  type ErrorEnvelope,
  type ErrorType,
  type Resource,
} from '../../../core/types/errors';
import { decodeRevert } from './revert';

type Ctx = Record<string, unknown>;

// Wraps an unknown error into a ZKsyncError of the given type, preserving context.
export function toZKsyncError(
  type: ErrorType,
  base: Omit<ErrorEnvelope, 'type' | 'revert' | 'cause'>,
  err: unknown,
) {
  if (isZKsyncError(err)) return err;
  const revert = decodeRevert(err);
  return createError(type, { ...base, ...(revert ? { revert } : {}), cause: shapeCause(err) });
}

type WrapOptions<TCtx extends Ctx = Ctx> = {
  /** Optional contextual data for debugging */
  ctx?: TCtx;
  /** Optional error message */
  message?: string | (() => string);
};

function resolveMessage(op: string, msg?: string | (() => string)) {
  if (!msg) return `Error during ${op}.`;
  return typeof msg === 'function' ? msg() : msg;
}

/**
 * Factory for resource-scoped error handlers.
 * Example:
 *   const { wrap, wrapAs, toResult } = createErrorHandlers('deposits');
 */
export function createErrorHandlers(resource: Resource) {
  async function run<T, TCtx extends Ctx = Ctx>(
    kind: ErrorType,
    operation: string,
    fn: () => T | Promise<T>,
    opts?: WrapOptions<TCtx>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      // If already shaped, preserve it; else wrap with chosen kind.
      if (isZKsyncError(e)) throw e;
      const message = resolveMessage(operation, opts?.message);
      throw toZKsyncError(kind, { resource, operation, context: opts?.ctx ?? {}, message }, e);
    }
  }

  function wrap<T, TCtx extends Ctx = Ctx>(
    operation: string,
    fn: () => T | Promise<T>,
    opts?: WrapOptions<TCtx>,
  ): Promise<T> {
    return run('INTERNAL', operation, fn, opts);
  }

  // TODO: can likely be removed
  function wrapAs<T, TCtx extends Ctx = Ctx>(
    kind: ErrorType,
    operation: string,
    fn: () => T | Promise<T>,
    opts?: WrapOptions<TCtx>,
  ): Promise<T> {
    return run(kind, operation, fn, opts);
  }

  async function toResult<T, TCtx extends Ctx = Ctx>(
    operation: string,
    fn: () => T | Promise<T>,
    opts?: WrapOptions<TCtx>,
  ): Promise<TryResult<T>> {
    try {
      const value = await wrap(operation, fn, opts);
      return { ok: true, value };
    } catch (e) {
      // Ensure we always return a shaped error
      const shaped = isZKsyncError(e)
        ? e
        : toZKsyncError(
            'INTERNAL',
            {
              resource,
              operation,
              context: opts?.ctx ?? {},
              message: resolveMessage(operation, opts?.message),
            },
            e,
          );
      return { ok: false, error: shaped };
    }
  }

  return { wrap, wrapAs, toResult };
}
