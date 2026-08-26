// tests/withdrawals/protocol.test.ts
import { describe, it, expect } from 'bun:test';
import {
  detectWithdrawalProtocol,
  protocolFromVersion,
  MIN_INTEROP_WITHDRAWAL_MINOR,
  type WithdrawalProtocolProbes,
} from '../protocol';
import { L2_INTEROP_ATTRIBUTE_PARSER_ADDRESS } from '../../../constants';
import type { Address, ProtocolVersion } from '../../../types/primitives';

function probes(opts: {
  version?: ProtocolVersion;
  code?: Address[];
  onCode?: (a: Address) => void;
}): WithdrawalProtocolProbes {
  const code = new Set((opts.code ?? []).map((a) => a.toLowerCase()));
  return {
    protocolVersion: () => Promise.resolve(opts.version),
    hasCodeAt: (address) => {
      opts.onCode?.(address);
      return Promise.resolve(code.has(address.toLowerCase()));
    },
  };
}

describe('withdrawals/protocolFromVersion', () => {
  it('treats v31 and below as the legacy withdrawal protocol', () => {
    expect(protocolFromVersion([0, 26, 0])).toBe('legacy-withdrawal');
    expect(protocolFromVersion([0, 31, 0])).toBe('legacy-withdrawal');
    expect(protocolFromVersion([0, 31, 7])).toBe('legacy-withdrawal');
  });

  it('treats v32 and above as the interop-bundle protocol', () => {
    expect(protocolFromVersion([0, MIN_INTEROP_WITHDRAWAL_MINOR, 0])).toBe('interop-bundle');
    expect(protocolFromVersion([0, 32, 3])).toBe('interop-bundle');
    expect(protocolFromVersion([0, 40, 0])).toBe('interop-bundle');
  });
});

describe('withdrawals/detectWithdrawalProtocol', () => {
  it('honours an explicit override without probing', async () => {
    let probed = false;
    const detection = await detectWithdrawalProtocol(
      probes({ version: [0, 31, 0], onCode: () => (probed = true) }),
      'interop-bundle',
    );

    expect(detection.protocol).toBe('interop-bundle');
    expect(detection.source).toEqual({ via: 'override' });
    expect(probed).toBe(false);
  });

  it('prefers the protocol version when it is readable', async () => {
    let probed = false;
    const detection = await detectWithdrawalProtocol(
      probes({ version: [0, 32, 0], onCode: () => (probed = true) }),
    );

    expect(detection.protocol).toBe('interop-bundle');
    expect(detection.source).toEqual({ via: 'protocol-version', version: [0, 32, 0] });
    // The version is authoritative, so no bytecode probe should be needed.
    expect(probed).toBe(false);
  });

  it('reports the legacy protocol for a readable pre-v32 version', async () => {
    const detection = await detectWithdrawalProtocol(probes({ version: [0, 31, 0] }));
    expect(detection.protocol).toBe('legacy-withdrawal');
  });

  it('falls back to the attribute-parser bytecode probe when the version is unreadable', async () => {
    const detection = await detectWithdrawalProtocol(
      probes({ code: [L2_INTEROP_ATTRIBUTE_PARSER_ADDRESS] }),
    );

    expect(detection.protocol).toBe('interop-bundle');
    expect(detection.source).toEqual({
      via: 'code-probe',
      address: L2_INTEROP_ATTRIBUTE_PARSER_ADDRESS,
    });
  });

  it('detects an EraVM v32 chain, which has none of the atomic-interop built-ins', async () => {
    // Those built-ins are force-deployed on ZKsync OS only, which is exactly why the parser — not
    // one of them — is the sentinel: on EraVM only the parser is there to be found.
    const detection = await detectWithdrawalProtocol(
      probes({ code: [L2_INTEROP_ATTRIBUTE_PARSER_ADDRESS] }),
    );
    expect(detection.protocol).toBe('interop-bundle');
  });

  it('degrades to the legacy protocol when both probes fail', async () => {
    // A partial client (no `getChainProtocolVersion`, no `getCode`) or a provider that rejects
    // both calls must not break withdrawals — the adapters swallow those failures, and detection
    // must then settle on the pre-v32 protocol rather than throwing.
    const detection = await detectWithdrawalProtocol({
      protocolVersion: () => Promise.resolve(undefined),
      hasCodeAt: () => Promise.resolve(false),
    });
    expect(detection.protocol).toBe('legacy-withdrawal');
  });

  it('reports the legacy protocol when the probe finds no code', async () => {
    const detection = await detectWithdrawalProtocol(probes({ code: [] }));
    expect(detection.protocol).toBe('legacy-withdrawal');
    expect(detection.source).toEqual({
      via: 'code-probe',
      address: L2_INTEROP_ATTRIBUTE_PARSER_ADDRESS,
    });
  });
});
