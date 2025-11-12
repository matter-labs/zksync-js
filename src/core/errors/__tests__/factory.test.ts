/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { describe, it, expect } from 'bun:test';
import { createError, shapeCause } from '../factory';
import { isZKsyncError } from '../../types/errors';

describe('errors/factory.createError', () => {
  it('creates a ZKsyncError with the given envelope', () => {
    const err = createError('RPC', {
      message: 'boom',
      operation: 'rpc.test',
      resource: 'zksrpc',
      context: { foo: 1 },
    });

    expect(isZKsyncError(err)).toBe(true);
    const env = (err as any).envelope;
    expect(env.type).toBe('RPC');
    expect(env.message).toBe('boom');
    expect(env.operation).toBe('rpc.test');
    expect(env.resource).toBe('zksrpc');
    expect(env.context).toEqual({ foo: 1 });
  });
});

describe('errors/factory.shapeCause', () => {
  it('picks name/message/code and trims hex-like data', () => {
    const input = {
      name: 'ProviderError',
      message: 'call reverted',
      code: -32000,
      data: '0xabcdef0123456789abcdef',
    };
    const shaped = shapeCause(input);
    expect(shaped.name).toBe('ProviderError');
    expect(shaped.message).toBe('call reverted');
    expect(shaped.code).toBe(-32000);
    expect(shaped.data).toMatch(/^0x[0-9a-fA-F]{8}…$/);
  });

  it('falls back to shortMessage when message is absent', () => {
    const input = {
      name: 'ViemError',
      shortMessage: 'execution reverted',
      code: 'VX1',
    };
    const shaped = shapeCause(input);
    expect(shaped.message).toBe('execution reverted');
    expect(shaped.code).toBe('VX1');
  });

  it('reads nested data from data.data or error.data', () => {
    const nested1 = { data: { data: '0xdeadbeefcafebabedead' } };
    const nested2 = { error: { data: '0xfeedfacecafedeadbeef' } };

    expect(shapeCause(nested1).data).toMatch(/^0x[0-9a-fA-F]{8}…$/);
    expect(shapeCause(nested2).data).toMatch(/^0x[0-9a-fA-F]{8}…$/);
  });

  it('omits data when not hex-like', () => {
    const shaped = shapeCause({ data: { reason: 'not-hex' } });
    expect(shaped.data).toBeUndefined();
  });
});
