/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect } from 'bun:test';
import { withRpcOp } from '../rpc';
import { createError } from '../factory';
import { isZKsyncError, Resource } from '../../types/errors';

describe('errors/rpc.withRpcOp', () => {
  it('returns value on success', async () => {
    const out = await withRpcOp('op.test', 'Failed op', {}, async () => {
      return await Promise.resolve(42);
    });
    expect(out).toBe(42);
  });

  it('wraps non-ZK errors into ZKsyncError(type=RPC)', async () => {
    let err: unknown;
    try {
      await withRpcOp('op.test', 'Failed op', { txHash: '0x1' }, () => {
        const e: any = new Error('boom');
        e.code = -32000;
        e.data = '0xabcdef0123456789';
        throw e;
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    expect(isZKsyncError(err)).toBe(true);
    const env = (err as any).envelope;
    expect(env.type).toBe('RPC');
    expect(env.operation).toBe('op.test');
    expect(env.resource).toBe('zksrpc' as Resource);
    expect(env.message).toBe('Failed op');
    // shaped cause fields retained
    expect(env.cause?.message).toBe('boom');
    expect(env.cause?.code).toBe(-32000);
    expect(env.cause?.data).toMatch(/^0x[0-9a-fA-F]{8}…$/);
  });

  it('rethrows existing ZKsyncError without wrapping', async () => {
    const original = createError('STATE', {
      message: 'not ready',
      operation: 'op.inner',
      resource: 'zksrpc' as Resource,
      context: { step: 'waiting' },
    });

    let err: unknown;
    try {
      await withRpcOp('op.outer', 'outer msg', {}, () => {
        throw original;
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBe(original);
    const env = (err as any).envelope;
    expect(env.type).toBe('STATE');
    expect(env.operation).toBe('op.inner');
    expect(env.message).toBe('not ready');
  });
});
