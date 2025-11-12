// core/types/__tests__/errors.test.ts
import { describe, it, expect } from 'bun:test';
import util from 'node:util';

import {
  ZKsyncError,
  isZKsyncError,
  OP_DEPOSITS,
  OP_WITHDRAWALS,
  type ErrorEnvelope,
} from '../errors';

function makeEnvelope(overrides: Partial<ErrorEnvelope> = {}): ErrorEnvelope {
  return {
    type: 'RPC',
    resource: 'zksrpc',
    operation: 'rpc.test',
    message: 'Something went wrong',
    context: { txHash: '0x' + 'ab'.repeat(32), nonce: 1, step: 'doing-stuff' },
    revert: {
      selector: '0x08c379a0',
      name: 'Error',
      args: ['0x' + 'cd'.repeat(32)],
      contract: 'SomeContract',
      fn: 'someFn(bytes32)',
    },
    cause: { name: 'TimeoutError', code: 'ETIMEDOUT', message: '5000ms exceeded' },
    ...overrides,
  };
}

describe('types/errors — ZKsyncError', () => {
  it('constructs with envelope and formats a human-readable message', () => {
    const env = makeEnvelope();
    const err = new ZKsyncError(env);

    // Basic identity
    expect(err.name).toBe('ZKsyncError');
    expect(err.envelope).toBe(env);

    // The Error.message is the pretty string; spot-check key parts
    expect(err.message).toContain('ZKsyncError [RPC]');
    expect(err.message).toMatch(/Message\s+: Something went wrong/);
    expect(err.message).toMatch(/Operation\s+: rpc.test/);
    if (/Resource\s+:/.test(err.message)) {
      expect(err.message).toMatch(/Resource\s+: zksrpc/);
    }

    // Cause and revert details included
    expect(err.message).toMatch(/Cause/);
    expect(err.message).toMatch(/Revert/);
  });

  it('toJSON exposes structured envelope data', () => {
    const env = makeEnvelope({ message: 'Boom' });
    const err = new ZKsyncError(env);
    const json = err.toJSON();

    expect(json.name).toBe('ZKsyncError');
    expect(json.type).toBe('RPC');
    expect(json.message).toBe('Boom');
    expect(json.operation).toBe('rpc.test');
    expect(json.resource).toBe('zksrpc');
    // Context is preserved
    expect(json.context).toMatchObject({ nonce: 1, step: 'doing-stuff' });
  });

  it('util.inspect uses the pretty formatter', () => {
    const env = makeEnvelope({ message: 'Inspect me' });
    const err = new ZKsyncError(env);

    const inspected = util.inspect(err);
    expect(inspected.startsWith('ZKsyncError: ')).toBe(true);
    expect(inspected).toContain('Inspect me');
    expect(inspected).toContain('[RPC]');
  });
});

describe('types/errors — isZKsyncError', () => {
  it('returns true for ZKsyncError instances', () => {
    const err = new ZKsyncError(makeEnvelope());
    expect(isZKsyncError(err)).toBe(true);
  });

  it('returns false for plain errors and other values', () => {
    expect(isZKsyncError(new Error('nope'))).toBe(false);
    expect(isZKsyncError(null)).toBe(false);
    expect(isZKsyncError(undefined)).toBe(false);
    expect(isZKsyncError({ envelope: {} })).toBe(false); // missing required fields
  });
});

describe('types/errors — operation constants', () => {
  it('OP_DEPOSITS has stable keys and values for core ops', () => {
    expect(OP_DEPOSITS.quote).toBe('deposits.quote');
    expect(OP_DEPOSITS.tryWait).toBe('deposits.tryWait');
    expect(OP_DEPOSITS.base.estGas).toBe('deposits.erc20-base:estimateGas');
    expect(OP_DEPOSITS.eth.baseCost).toBe('deposits.eth:l2TransactionBaseCost');
  });

  it('OP_WITHDRAWALS has stable keys and values for finalize flow', () => {
    expect(OP_WITHDRAWALS.status).toBe('withdrawals.status');
    expect(OP_WITHDRAWALS.finalize.fetchParams.proof).toBe(
      'withdrawals.finalize.fetchParams:proof',
    );
    expect(OP_WITHDRAWALS.finalize.readiness.isFinalized).toBe(
      'withdrawals.finalize.readiness:isWithdrawalFinalized',
    );
    expect(OP_WITHDRAWALS.finalize.wait).toBe('withdrawals.finalize.finalizeDeposit:wait');
  });
});
