import { createError, shapeCause } from '../errors/factory';
import { isZKsyncError, type Resource } from '../types/errors';

type Ctx = Record<string, unknown>;

/** Wraps an async function, catching errors and rethrowing them as ZKsyncErrors with context. */
export async function withRpcOp<T>(
  operation: string,
  message: string,
  ctx: Ctx,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isZKsyncError(e)) throw e;
    throw createError('RPC', {
      resource: 'zksrpc' as Resource,
      operation,
      message,
      context: ctx,
      cause: shapeCause(e),
    });
  }
}
