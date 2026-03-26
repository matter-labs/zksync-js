import { describe, it, expect } from 'bun:test';
import { encodeErrorResult, parseAbi } from 'viem';
import { decodeRevert, registerErrorAbi, classifyReadinessFromRevert } from '../revert';

function errorStringData(msg: string): `0x${string}` {
  return encodeErrorResult({
    abi: [{ type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] }],
    errorName: 'Error',
    args: [msg],
  });
}

function panicData(code: number | bigint): `0x${string}` {
  return encodeErrorResult({
    abi: [{ type: 'error', name: 'Panic', inputs: [{ name: 'code', type: 'uint256' }] }],
    errorName: 'Panic',
    args: [BigInt(code)],
  });
}

function customErrorData(sig: string, args: unknown[] = []): `0x${string}` {
  const abi = parseAbi([`error ${sig}`]);
  const errorName = sig.split('(')[0]!;
  return encodeErrorResult({ abi, errorName, args: args as any[] });
}

describe('adapters/viem/errors/revert.decodeRevert', () => {
  it('returns undefined when no revert data is present', () => {
    expect(decodeRevert({})).toBeUndefined();
    expect(decodeRevert({ message: 'oops' })).toBeUndefined();
  });

  it('decodes Error(string)', () => {
    const data = errorStringData('hello');
    const e = { data };
    const out = decodeRevert(e)!;
    expect(out.selector.toLowerCase()).toBe('0x08c379a0');
    expect(out.name).toBe('Error');
    expect(Array.isArray(out.args)).toBe(true);
    expect(out.args?.[0]).toBe('hello');
  });

  it('decodes Panic(uint256)', () => {
    const data = panicData(0x12);
    const e = { error: { data } };
    const out = decodeRevert(e)!;
    expect(out.selector.toLowerCase()).toBe('0x4e487b71');
    expect(out.name).toBe('Panic');
    expect(out.args?.[0]).toBe(0x12n);
  });

  it('tries all supported nested error-data locations', () => {
    const data = errorStringData('nested!');
    const samples = [
      { data: { data } }, // e.data.data
      { error: { data } }, // e.error.data
      { data }, // e.data
      { error: { error: { data } } }, // e.error.error.data
      { info: { error: { data } } }, // e.info.error.data
    ];
    for (const s of samples) {
      const out = decodeRevert(s)!;
      expect(out.name).toBe('Error');
      expect(out.args?.[0]).toBe('nested!');
    }
  });

  it('falls back to selector when unable to decode with any ABI', () => {
    const data = '0xdeadbeef';
    const out = decodeRevert({ data })!;
    expect(out.name).toBeUndefined();
    expect(out.selector.toLowerCase()).toBe('0xdeadbeef');
  });

  it('registerErrorAbi enables decoding custom errors and labels contract', () => {
    registerErrorAbi('MyContract', [
      { type: 'error', name: 'AccessDenied', inputs: [{ name: 'who', type: 'address' }] },
    ] as const);
    const who = '0x1111111111111111111111111111111111111111';
    const data = customErrorData('AccessDenied(address)', [who]);

    const out = decodeRevert({ data })!;
    expect(out.name).toBe('AccessDenied');
    expect(out.contract).toBe('MyContract');
    expect(out.args?.[0]).toBe(who);
  });
});

describe('adapters/viem/errors/revert.classifyReadinessFromRevert', () => {
  it('classifies NOT_READY:paused by message substring', () => {
    const res = classifyReadinessFromRevert({ message: 'Execution reverted: circuit PAUSED' });
    expect(res).toEqual({ kind: 'NOT_READY', reason: 'paused' });
  });

  it('classifies UNFINALIZABLE:unsupported with name when mapping has no override', () => {
    registerErrorAbi('X', [{ type: 'error', name: 'TotallyUnknown', inputs: [] }] as const);
    const data = customErrorData('TotallyUnknown()');
    const res = classifyReadinessFromRevert({ data });
    expect(res.kind).toBe('UNFINALIZABLE');
    // @ts-expect-error
    expect(res.detail).toBe('TotallyUnknown');
  });

  it('classifies UNFINALIZABLE:unsupported with selector when no name is parsed', () => {
    const res = classifyReadinessFromRevert({ data: '0xdeadbeef' });
    expect(res.kind).toBe('UNFINALIZABLE');
    // @ts-expect-error
    expect(res.detail?.toLowerCase()).toBe('0xdeadbeef');
  });

  it('falls back to NOT_READY:unknown with lowercased message when no revert data', () => {
    const res = classifyReadinessFromRevert({ shortMessage: 'Something Else' });
    expect(res.kind).toBe('NOT_READY');
    // @ts-expect-error
    expect(res.detail).toBe('something else');
  });
});
