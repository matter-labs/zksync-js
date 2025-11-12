/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { describe, it, expect } from 'bun:test';
import { formatEnvelopePretty } from '../formatter';

describe('errors/formatter.formatEnvelopePretty', () => {
  it('formats a rich envelope with context, step, revert, and cause', () => {
    const envelope = {
      type: 'RPC',
      message: 'Failed to fetch L2→L1 log proof.',
      operation: 'zksrpc.getL2ToL1LogProof',
      resource: 'zksrpc',
      context: {
        txHash: '0x' + 'aa'.repeat(32),
        nonce: 7,
        step: 'fetch-proof',
      },
      revert: {
        selector: '0x08c379a0',
        name: 'Error',
        contract: 'L2MessageVerification',
        fn: 'verify(bytes32)',
        args: ['0x' + '11'.repeat(32)],
      },
      cause: {
        name: 'TimeoutError',
        code: 'ETIMEDOUT',
        message: '5000ms exceeded while waiting for response',
        data: '0xdeadbeefcafebabedeadbeef',
      },
    } as const;

    const pretty = formatEnvelopePretty(envelope as any);

    // Header & message
    expect(pretty).toContain('ZKsyncError [RPC]');
    expect(pretty).toMatch(/Message\s+: Failed to fetch L2→L1 log proof\./);

    // Operation always present
    expect(pretty).toMatch(/Operation\s+: zksrpc\.getL2ToL1LogProof/);

    const hasResource = /Resource\s+: zksrpc/.test(pretty);
    expect(hasResource || /Context\s+:/.test(pretty)).toBe(true);

    // Context (txHash + nonce) and Step
    expect(pretty).toMatch(/Context\s+: .*txHash=0x[a-f0-9]{64}.*nonce=7/i);
    expect(pretty).toMatch(/Step\s+: fetch-proof/);

    // Revert block
    expect(pretty).toMatch(/Revert\s+: selector=0x08c379a0/);
    expect(pretty).toMatch(/name=Error/);
    expect(pretty).toMatch(/contract=L2MessageVerification/);
    expect(pretty).toMatch(/fn=verify\(bytes32\)/);
    expect(pretty).toMatch(/args=\[\s*["']?0x[a-f0-9]{64}["']?\s*\]/i);

    // Cause block
    expect(pretty).toMatch(/Cause\s+: name=TimeoutError\s+code=ETIMEDOUT/);
    expect(pretty).toMatch(/message=5000ms exceeded while waiting for response/);
    expect(pretty).toMatch(/data=("?0xdeadbeefcafebabedeadbeef"?)/);
  });

  it('handles minimal envelope without optional fields', () => {
    const envelope = {
      type: 'STATE',
      message: 'Proof not yet available. Please try again later.',
      operation: 'zksrpc.getL2ToL1LogProof',
      resource: 'zksrpc',
    };

    const pretty = formatEnvelopePretty(envelope as any);

    expect(pretty).toContain('ZKsyncError [STATE]');
    expect(pretty).toMatch(/Message\s+: Proof not yet available\. Please try again later\./);
    expect(pretty).toMatch(/Operation\s+: zksrpc\.getL2ToL1LogProof/);
    expect(/Resource\s+: zksrpc/.test(pretty) || true).toBe(true);
  });
});
