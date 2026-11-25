/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'bun:test';
import {
  createZksRpc,
  normalizeProof,
  normalizeGenesis,
  normalizeBlockMetadata,
  normalizeImtProof,
  ProofTarget,
} from '../zks';
import type { RpcTransport } from '../types';
import { isZKsyncError } from '../../types/errors';

// Minimal transport fake (map method -> value or function)
function fakeTransport(map: Record<string, any | ((...p: any[]) => any)>): RpcTransport {
  return (method, params = []) => {
    const handler = map[method];
    if (handler === undefined) return Promise.reject(new Error(`unexpected method: ${method}`));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = typeof handler === 'function' ? handler(...params) : handler;
    return Promise.resolve(result);
  };
}

describe('rpc/zks.normalizeProof', () => {
  it('normalizes id/index and batch_number/batchNumber with string/number/bigint', () => {
    const a = normalizeProof({
      id: '1',
      batch_number: '2',
      proof: [('0x' + '00'.repeat(32)) as `0x${string}`],
    });
    expect(a).toEqual({
      id: 1n,
      batchNumber: 2n,
      proof: [('0x' + '00'.repeat(32)) as `0x${string}`],
    });

    const b = normalizeProof({
      index: 3,
      batchNumber: 4n,
      proof: ['0x1', '0x2'],
    });
    expect(b).toEqual({
      id: 3n,
      batchNumber: 4n,
      proof: ['0x1', '0x2'],
    });
  });

  it('throws ZKsyncError for missing id or batch number', () => {
    try {
      normalizeProof({ proof: [] });
      throw new Error('expected to throw');
    } catch (e) {
      expect(isZKsyncError(e)).toBe(true);
      expect(String(e)).toContain('Malformed proof: missing id or batch number');
    }
  });

  it('throws ZKsyncError for invalid numeric field types', () => {
    try {
      normalizeProof({ id: {}, batch_number: 1, proof: [] });
      throw new Error('expected to throw');
    } catch (e) {
      expect(isZKsyncError(e)).toBe(true);
      expect(String(e)).toContain('Malformed proof: invalid numeric field');
    }
  });
});

describe('rpc/zks.normalizeGenesis', () => {
  const sample = {
    initial_contracts: [
      ['0x' + '11'.repeat(20), '0x' + 'aa'.repeat(4)],
      ['0x' + '22'.repeat(20), '0x' + 'bb'.repeat(4)],
    ],
    additional_storage: [['0x' + '33'.repeat(32), '0x' + '44'.repeat(32)]],
    genesis_root: '0x' + '55'.repeat(32),
  };

  it('normalizes tuples and camel-cases field names (raw additional_storage)', () => {
    const normalized = normalizeGenesis(sample);

    expect(normalized).toEqual({
      initialContracts: [
        { address: sample.initial_contracts[0][0], bytecode: sample.initial_contracts[0][1] },
        { address: sample.initial_contracts[1][0], bytecode: sample.initial_contracts[1][1] },
      ],
      additionalStorage: [
        {
          format: 'raw',
          key: sample.additional_storage[0][0],
          value: sample.additional_storage[0][1],
        },
      ],
      genesisRoot: sample.genesis_root,
    });
  });

  it('normalizes pretty additional_storage map format', () => {
    const addr = '0x' + 'aa'.repeat(20);
    const slot = '0x' + '33'.repeat(32);
    const val = '0x' + '44'.repeat(32);

    const prettySample = {
      ...sample,
      additional_storage: {
        [addr]: {
          [slot]: val,
        },
      },
    };

    const normalized = normalizeGenesis(prettySample);

    expect(normalized.additionalStorage).toEqual([
      {
        format: 'pretty',
        address: addr,
        key: slot,
        value: val,
      },
    ]);
  });

  it('falls back to additional_storage_raw when additional_storage is missing', () => {
    const fallbackSample = {
      initial_contracts: sample.initial_contracts,
      additional_storage_raw: [['0x' + '33'.repeat(32), '0x' + '44'.repeat(32)]],
      genesis_root: sample.genesis_root,
    };

    const normalized = normalizeGenesis(fallbackSample);

    expect(normalized.additionalStorage).toEqual([
      {
        format: 'raw',
        key: fallbackSample.additional_storage_raw[0][0],
        value: fallbackSample.additional_storage_raw[0][1],
      },
    ]);
  });
});

describe('rpc/zks.normalizeBlockMetadata', () => {
  const sample = {
    pubdata_price_per_byte: '0x7ea8ed4bb',
    native_price: '0xf4240',
    execution_version: 1,
  };

  it('normalizes snake-cased fields', () => {
    const normalized = normalizeBlockMetadata(sample);
    expect(normalized).toEqual({
      pubdataPricePerByte: 0x7ea8ed4bbn,
      nativePrice: 0xf4240n,
      executionVersion: 1,
    });
  });

  it('throws ZKsyncError on malformed response', () => {
    try {
      normalizeBlockMetadata(null);
      throw new Error('expected to throw');
    } catch (e) {
      expect(isZKsyncError(e)).toBe(true);
      expect(String(e)).toContain('Malformed block metadata response');
    }
  });
});

describe('rpc/zks.getBridgehubAddress', () => {
  it('returns a hex address when RPC responds with a 0x-prefixed string', async () => {
    const rpc = createZksRpc(
      fakeTransport({ zks_getBridgehubContract: '0x1234567890abcdef1234567890abcdef12345678' }),
    );
    const addr = await rpc.getBridgehubAddress();
    expect(addr).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('wraps unexpected response shape into ZKsyncError', () => {
    const rpc = createZksRpc(fakeTransport({ zks_getBridgehubContract: 42 }));
    return expect(rpc.getBridgehubAddress()).rejects.toThrow(
      /Unexpected Bridgehub address response/,
    );
  });
});

describe('rpc/zks.getBytecodeSupplierAddress', () => {
  it('returns a hex address when RPC responds with a 0x-prefixed string', async () => {
    const rpc = createZksRpc(
      fakeTransport({
        zks_getBytecodeSupplierContract: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      }),
    );
    const addr = await rpc.getBytecodeSupplierAddress();
    expect(addr).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
  });

  it('wraps unexpected response shape into ZKsyncError', () => {
    const rpc = createZksRpc(fakeTransport({ zks_getBytecodeSupplierContract: 123 }));
    return expect(rpc.getBytecodeSupplierAddress()).rejects.toThrow(
      /Unexpected Bytecode Supplier address response/,
    );
  });
});

describe('rpc/zks.getL2ToL1LogProof', () => {
  it('returns normalized proof on success', async () => {
    const proof = {
      index: '5',
      batchNumber: '10',
      proof: [('0x' + '11'.repeat(32)) as `0x${string}`],
      root: ('0x' + '22'.repeat(32)) as `0x${string}`,
    };
    const rpc = createZksRpc(fakeTransport({ zks_getL2ToL1LogProof: () => proof }));
    const out = await rpc.getL2ToL1LogProof(('0x' + 'aa'.repeat(32)) as `0x${string}`, 0);
    expect(out).toEqual({ id: 5n, batchNumber: 10n, proof: proof.proof, root: proof.root });
  });

  it('normalizes gatewayBlockNumber when present', async () => {
    const proof = {
      index: '1',
      batchNumber: '2',
      proof: [],
      root: ('0x' + '33'.repeat(32)) as `0x${string}`,
      gatewayBlockNumber: '42',
    };
    const rpc = createZksRpc(fakeTransport({ zks_getL2ToL1LogProof: () => proof }));
    const out = await rpc.getL2ToL1LogProof(('0x' + 'aa'.repeat(32)) as `0x${string}`, 0);
    expect(out.gatewayBlockNumber).toBe(42n);
  });

  it('omits gatewayBlockNumber when not in response', async () => {
    const proof = {
      index: '1',
      batchNumber: '2',
      proof: [],
      root: ('0x' + '33'.repeat(32)) as `0x${string}`,
    };
    const rpc = createZksRpc(fakeTransport({ zks_getL2ToL1LogProof: () => proof }));
    const out = await rpc.getL2ToL1LogProof(('0x' + 'aa'.repeat(32)) as `0x${string}`, 0);
    expect(out.gatewayBlockNumber).toBeUndefined();
  });

  it('throws STATE error when proof is unavailable (null/undefined/falsey)', () => {
    const rpc = createZksRpc(fakeTransport({ zks_getL2ToL1LogProof: null }));
    return expect(
      rpc.getL2ToL1LogProof(('0x' + 'bb'.repeat(32)) as `0x${string}`, 1),
    ).rejects.toThrow(/Proof not yet available/);
  });

  it('forwards proofTarget as third RPC param when provided', async () => {
    let capturedParams: unknown[] = [];
    const proof = { index: '0', batchNumber: '1', proof: [], root: '0x' + '00'.repeat(32) };
    const rpc = createZksRpc((_method, params = []) => {
      capturedParams = params;
      return Promise.resolve(proof);
    });
    await rpc.getL2ToL1LogProof(
      ('0x' + 'cc'.repeat(32)) as `0x${string}`,
      0,
      ProofTarget.MessageRoot,
    );
    expect(capturedParams[2]).toBe(ProofTarget.MessageRoot);
  });

  it('omits proofTarget from RPC params when not provided', async () => {
    let capturedParams: unknown[] = [];
    const proof = { index: '0', batchNumber: '1', proof: [], root: '0x' + '00'.repeat(32) };
    const rpc = createZksRpc((_method, params = []) => {
      capturedParams = params;
      return Promise.resolve(proof);
    });
    await rpc.getL2ToL1LogProof(('0x' + 'dd'.repeat(32)) as `0x${string}`, 0);
    expect(capturedParams.length).toBe(2);
  });
});

describe('rpc/zks.getReceiptWithL2ToL1', () => {
  it('returns null when RPC returns null', async () => {
    const rpc = createZksRpc(fakeTransport({ eth_getTransactionReceipt: null }));
    const rcpt = await rpc.getReceiptWithL2ToL1(('0x' + 'cc'.repeat(32)) as `0x${string}`);
    expect(rcpt).toBeNull();
  });

  it('ensures l2ToL1Logs is an array even if missing or malformed', async () => {
    const base = { transactionHash: '0x' + 'dd'.repeat(32), status: 1 };
    const rpc1 = createZksRpc(fakeTransport({ eth_getTransactionReceipt: { ...base } }));
    const out1 = await rpc1.getReceiptWithL2ToL1(('0x' + 'dd'.repeat(32)) as `0x${string}`);
    expect(out1?.l2ToL1Logs).toEqual([]);

    const rpc2 = createZksRpc(
      fakeTransport({ eth_getTransactionReceipt: { ...base, l2ToL1Logs: 'not-an-array' } }),
    );
    const out2 = await rpc2.getReceiptWithL2ToL1(('0x' + 'ee'.repeat(32)) as `0x${string}`);
    expect(out2?.l2ToL1Logs).toEqual([]);

    const logs = [
      {
        l2_shard_id: 0,
        is_service: false,
        tx_number_in_block: 1,
        sender: '0x0' as any,
        key: '0x1' as any,
        value: '0x2' as any,
      },
    ];
    const rpc3 = createZksRpc(
      fakeTransport({ eth_getTransactionReceipt: { ...base, l2ToL1Logs: logs } }),
    );
    const out3 = await rpc3.getReceiptWithL2ToL1(('0x' + 'ff'.repeat(32)) as `0x${string}`);
    expect(out3?.l2ToL1Logs).toEqual(logs);
  });
});

describe('rpc/zks.getGenesis', () => {
  it('returns normalized genesis data (raw additional_storage)', async () => {
    const raw = {
      initial_contracts: [['0x' + '11'.repeat(20), '0x' + 'aa'.repeat(4)]],
      additional_storage: [['0x' + '22'.repeat(32), '0x' + '33'.repeat(32)]],
      genesis_root: '0x' + '44'.repeat(32),
    };

    const rpc = createZksRpc(fakeTransport({ zks_getGenesis: raw }));
    const out = await rpc.getGenesis();

    expect(out).toEqual({
      initialContracts: [
        { address: raw.initial_contracts[0][0], bytecode: raw.initial_contracts[0][1] },
      ],
      additionalStorage: [
        {
          format: 'raw',
          key: raw.additional_storage[0][0],
          value: raw.additional_storage[0][1],
        },
      ],
      genesisRoot: raw.genesis_root,
    });
  });
  it('returns normalized genesis data (pretty additional_storage)', async () => {
    const addr = '0x' + 'aa'.repeat(20);
    const slot = '0x' + '22'.repeat(32);
    const val = '0x' + '33'.repeat(32);

    const raw = {
      initial_contracts: [['0x' + '11'.repeat(20), '0x' + 'aa'.repeat(4)]],
      additional_storage: {
        [addr]: {
          [slot]: val,
        },
      },
      genesis_root: '0x' + '44'.repeat(32),
    };

    const rpc = createZksRpc(fakeTransport({ zks_getGenesis: raw }));
    const out = await rpc.getGenesis();

    expect(out.additionalStorage).toEqual([
      {
        format: 'pretty',
        address: addr,
        key: slot,
        value: val,
      },
    ]);
  });
});

describe('rpc/zks.getBlockMetadataByNumber', () => {
  it('returns null when RPC returns null', async () => {
    const rpc = createZksRpc(fakeTransport({ zks_getBlockMetadataByNumber: null }));
    const out = await rpc.getBlockMetadataByNumber(123);
    expect(out).toBeNull();
  });

  it('returns normalized block metadata', async () => {
    const raw = {
      pubdata_price_per_byte: '0x2a',
      native_price: '0x2b',
      execution_version: 3,
    };
    const rpc = createZksRpc(fakeTransport({ zks_getBlockMetadataByNumber: raw }));
    const out = await rpc.getBlockMetadataByNumber(456);
    expect(out).toEqual({
      pubdataPricePerByte: 0x2an,
      nativePrice: 0x2bn,
      executionVersion: 3,
    });
  });
});

// An IMT proof as zksync-os-server serializes it: U256/B256 as hex strings, u64 as JSON numbers.
const W = (byte: string): `0x${string}` => `0x${byte.repeat(32)}`;
const RAW_IMT_PROOF = {
  batchNumber: 12,
  settlementBlockNumber: 345,
  provesAgainstBeginRoot: false,
  chainImtRoot: W('11'),
  settlementProof: [W('22'), W('33')],
  leaf: { value: '0x2a', nextIndex: '0x0', nextValue: '0xff' },
  imtLeafIndex: 7,
  imtProof: [W('44')],
};
const NORMALIZED_IMT_PROOF = {
  batchNumber: 12n,
  settlementBlockNumber: 345n,
  provesAgainstBeginRoot: false,
  chainImtRoot: W('11'),
  settlementProof: [W('22'), W('33')],
  leaf: { value: 42n, nextIndex: 0n, nextValue: 255n },
  imtLeafIndex: 7n,
  imtProof: [W('44')],
};
const COMMIT_VALUE = W('ab');

describe('rpc/zks.normalizeImtProof', () => {
  it('normalizes the node response into bigints', () => {
    expect(normalizeImtProof(RAW_IMT_PROOF)).toEqual(NORMALIZED_IMT_PROOF);
  });

  it('throws ZKsyncError on malformed responses', () => {
    for (const bad of [
      null,
      { ...RAW_IMT_PROOF, chainImtRoot: '0x12' },
      { ...RAW_IMT_PROOF, provesAgainstBeginRoot: 'no' },
      { ...RAW_IMT_PROOF, settlementProof: 'nope' },
      { ...RAW_IMT_PROOF, imtProof: ['0x1'] },
      { ...RAW_IMT_PROOF, leaf: null },
      { ...RAW_IMT_PROOF, batchNumber: undefined },
    ]) {
      expect(() => normalizeImtProof(bad)).toThrow();
      try {
        normalizeImtProof(bad);
      } catch (e) {
        expect(isZKsyncError(e, { type: 'RPC' })).toBe(true);
      }
    }
  });
});

describe('rpc/zks.getImtInclusionProof', () => {
  it('sends the commit value and block number and normalizes the proof', async () => {
    let seen: unknown[] = [];
    const rpc = createZksRpc(
      fakeTransport({
        zks_getImtInclusionProof: (...params: unknown[]) => {
          seen = params;
          return RAW_IMT_PROOF;
        },
      }),
    );
    expect(await rpc.getImtInclusionProof(COMMIT_VALUE, 99n)).toEqual(NORMALIZED_IMT_PROOF);
    expect(seen).toEqual([COMMIT_VALUE, 99]);
  });

  it('returns null when no leaf holds the value', async () => {
    const rpc = createZksRpc(fakeTransport({ zks_getImtInclusionProof: null }));
    expect(await rpc.getImtInclusionProof(COMMIT_VALUE, 1)).toBeNull();
  });

  it('rejects a commit value that is not a 32-byte word, without calling the node', async () => {
    const rpc = createZksRpc(fakeTransport({}));
    let err: unknown;
    try {
      await rpc.getImtInclusionProof('0x2a', 1);
    } catch (e) {
      err = e;
    }
    expect(isZKsyncError(err, { type: 'VALIDATION' })).toBe(true);
  });

  it('rejects a block number that is not a non-negative safe integer', async () => {
    const rpc = createZksRpc(fakeTransport({}));
    for (const bad of [-1n, 1n << 60n, 1.5]) {
      let err: unknown;
      try {
        await rpc.getImtInclusionProof(COMMIT_VALUE, bad);
      } catch (e) {
        err = e;
      }
      expect(isZKsyncError(err, { type: 'VALIDATION' })).toBe(true);
    }
  });
});

describe('rpc/zks.getImtNonInclusionProof', () => {
  it('sends the commit value and batch number and normalizes the proof', async () => {
    let seen: unknown[] = [];
    const rpc = createZksRpc(
      fakeTransport({
        zks_getImtNonInclusionProof: (...params: unknown[]) => {
          seen = params;
          return { ...RAW_IMT_PROOF, provesAgainstBeginRoot: true };
        },
      }),
    );
    expect(await rpc.getImtNonInclusionProof(COMMIT_VALUE, 12)).toEqual({
      ...NORMALIZED_IMT_PROOF,
      provesAgainstBeginRoot: true,
    });
    expect(seen).toEqual([COMMIT_VALUE, 12]);
  });

  it('returns null when the value is present', async () => {
    const rpc = createZksRpc(fakeTransport({ zks_getImtNonInclusionProof: null }));
    expect(await rpc.getImtNonInclusionProof(COMMIT_VALUE, 12)).toBeNull();
  });
});

describe('rpc/zks.getImtLowNullifierIndex', () => {
  it('returns the index as a bigint', async () => {
    let seen: unknown[] = [];
    const rpc = createZksRpc(
      fakeTransport({
        zks_getImtLowNullifierIndex: (...params: unknown[]) => {
          seen = params;
          return 5;
        },
      }),
    );
    expect(await rpc.getImtLowNullifierIndex(COMMIT_VALUE, 100)).toBe(5n);
    expect(seen).toEqual([COMMIT_VALUE, 100]);
  });

  it('returns null when the node has no answer, and wraps a malformed one', async () => {
    const none = createZksRpc(fakeTransport({ zks_getImtLowNullifierIndex: null }));
    expect(await none.getImtLowNullifierIndex(COMMIT_VALUE, 1)).toBeNull();

    const bad = createZksRpc(fakeTransport({ zks_getImtLowNullifierIndex: { index: 1 } }));
    let err: unknown;
    try {
      await bad.getImtLowNullifierIndex(COMMIT_VALUE, 1);
    } catch (e) {
      err = e;
    }
    expect(isZKsyncError(err, { type: 'RPC' })).toBe(true);
  });
});
