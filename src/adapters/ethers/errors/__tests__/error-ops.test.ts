import { describe, it, expect } from 'bun:test';
import { toZKsyncError, createErrorHandlers } from '../error-ops';
import { isZKsyncError, type TryResult } from '../../../../core/types/errors';
import { createError } from '../../../../core/errors/factory';

describe('adapters/ethers/errors/error-ops', () => {
  describe('toZKsyncError', () => {
    it('wraps a plain error with the provided type, base envelope, and shaped cause', () => {
      const base = {
        resource: 'deposits' as const,
        operation: 'adapters.ethers.test',
        message: 'Custom message',
        context: { foo: 1 },
      };
      const plain = new Error('boom');
      // @ts-expect-error
      plain.code = -32000;
      // @ts-expect-error
      plain.data = '0xdeadbeef';

      const err = toZKsyncError('EXECUTION', base, plain);
      expect(isZKsyncError(err)).toBe(true);

      const env = (err as any).envelope;
      expect(env.type).toBe('EXECUTION');
      expect(env.resource).toBe('deposits');
      expect(env.operation).toBe('adapters.ethers.test');
      expect(env.message).toBe('Custom message');
      expect(env.context).toEqual({ foo: 1 });
      expect(env.cause?.message).toBe('boom');
      expect(env.cause?.code).toBe(-32000);
    });

    it('returns the same ZKsyncError instance if already shaped', () => {
      const original = createError('STATE', {
        resource: 'withdrawals',
        operation: 'op.inner',
        message: 'already-shaped',
        context: { step: 'x' },
      });
      const out = toZKsyncError(
        'INTERNAL',
        { resource: 'withdrawals', operation: 'op.outer', message: 'outer', context: {} },
        original,
      );
      expect(out).toBe(original);
    });
  });

  describe('createErrorHandlers', () => {
    it('wrap() returns value on success', async () => {
      const { wrap } = createErrorHandlers('withdrawals');
      const val = await wrap('op.success', () => 42);
      expect(val).toBe(42);
    });

    it('wrap() converts plain errors to ZKsyncError with default message', async () => {
      const { wrap } = createErrorHandlers('withdrawals');
      let err: unknown;
      try {
        await wrap('op.defaultMsg', () => {
          throw new Error('bad');
        });
      } catch (e) {
        err = e;
      }

      expect(isZKsyncError(err)).toBe(true);
      const env = (err as any).envelope;
      expect(env.type).toBe('INTERNAL');
      expect(env.resource).toBe('withdrawals');
      expect(env.operation).toBe('op.defaultMsg');
      expect(env.message).toBe('Error during op.defaultMsg.');
      expect(env.cause?.message).toBe('bad');
    });

    it('wrap() respects custom message and context', async () => {
      const { wrap } = createErrorHandlers('deposits');
      let err: unknown;
      try {
        await wrap(
          'op.custom',
          () => {
            throw new Error('oops');
          },
          { message: 'Custom wrap message', ctx: { txHash: '0x1' } },
        );
      } catch (e) {
        err = e;
      }

      expect(isZKsyncError(err)).toBe(true);
      const env = (err as any).envelope;
      expect(env.message).toBe('Custom wrap message');
      expect(env.context).toEqual({ txHash: '0x1' });
    });

    it('wrapAs() uses the provided error type', async () => {
      const { wrapAs } = createErrorHandlers('helpers');
      let err: unknown;
      try {
        await wrapAs(
          'RPC',
          'op.rpc',
          () => {
            throw new Error('rpc boom');
          },
          { message: 'RPC failed' },
        );
      } catch (e) {
        err = e;
      }

      expect(isZKsyncError(err)).toBe(true);
      const env = (err as any).envelope;
      expect(env.type).toBe('RPC');
      expect(env.message).toBe('RPC failed');
    });

    it('wrap() rethrows existing ZKsyncError unchanged', async () => {
      const { wrap } = createErrorHandlers('withdrawals');
      const original = createError('STATE', {
        resource: 'withdrawals',
        operation: 'op.inner',
        message: 'already-shaped',
      });

      let err: unknown;
      try {
        await wrap('op.outer', () => {
          throw original;
        });
      } catch (e) {
        err = e;
      }

      expect(err).toBe(original);
      const env = (err as any).envelope;
      expect(env.type).toBe('STATE');
      expect(env.operation).toBe('op.inner');
      expect(env.message).toBe('already-shaped');
    });

    it('toResult() returns ok:true on success', async () => {
      const { toResult } = createErrorHandlers('helpers');
      const r = (await toResult('op.ok', () => 'yay')) as TryResult<string>;
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toBe('yay');
      }
    });

    it('toResult() returns ok:false with shaped error on failure', async () => {
      const { toResult } = createErrorHandlers('helpers');
      const r = await toResult('op.fail', () => {
        throw new Error('nope');
      });

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(isZKsyncError(r.error)).toBe(true);
        const env = (r.error as any).envelope;
        expect(env.type).toBe('INTERNAL');
        expect(env.resource).toBe('helpers');
        expect(env.operation).toBe('op.fail');
        expect(env.message).toBe('Error during op.fail.');
      }
    });
  });
});
