/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'bun:test';
import {
  createZksRpc,
  normalizeBlockMetadata,
  normalizeGenesis,
  normalizeProof,
  normalizeStorageProof,
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

const storageProofAddress = ('0x' + '12'.repeat(20)) as `0x${string}`;
const storageProofKey = ('0x' + '34'.repeat(32)) as `0x${string}`;

const existingStorageProofResponse = {
  address: storageProofAddress,
  state_commitment_preimage: {
    next_free_slot: '0x10',
    block_number: 11,
    last256_block_hashes_blake: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
    last_block_timestamp: 12n,
  },
  storage_proofs: [
    {
      key: storageProofKey,
      proof: {
        type: 'existing',
        index: '0x2',
        value: ('0x' + 'bb'.repeat(32)) as `0x${string}`,
        next_index: 3,
        siblings: [('0x' + 'cc'.repeat(32)) as `0x${string}`],
      },
    },
  ],
  l1_verification_data: {
    batch_number: '0x4',
    number_of_layer1_txs: '5',
    priority_operations_hash: ('0x' + 'dd'.repeat(32)) as `0x${string}`,
    dependency_roots_rolling_hash: ('0x' + 'ee'.repeat(32)) as `0x${string}`,
    l2_to_l1_logs_root_hash: ('0x' + 'ff'.repeat(32)) as `0x${string}`,
    commitment: ('0x' + '11'.repeat(32)) as `0x${string}`,
  },
} as const;

const nonExistingStorageProofResponse = {
  address: storageProofAddress,
  stateCommitmentPreimage: {
    nextFreeSlot: 20,
    blockNumber: '0x15',
    last256BlockHashesBlake: ('0x' + '01'.repeat(32)) as `0x${string}`,
    lastBlockTimestamp: '22',
  },
  storageProofs: [
    {
      key: ('0x' + '56'.repeat(32)) as `0x${string}`,
      proof: {
        type: 'nonExisting',
        left_neighbor: {
          index: 7,
          leaf_key: ('0x' + '02'.repeat(32)) as `0x${string}`,
          value: ('0x' + '03'.repeat(32)) as `0x${string}`,
          next_index: '0x8',
          siblings: [('0x' + '04'.repeat(32)) as `0x${string}`],
        },
        rightNeighbor: {
          index: '9',
          leafKey: ('0x' + '05'.repeat(32)) as `0x${string}`,
          value: ('0x' + '06'.repeat(32)) as `0x${string}`,
          nextIndex: 10n,
          siblings: [('0x' + '07'.repeat(32)) as `0x${string}`],
        },
      },
    },
  ],
  l1VerificationData: {
    batchNumber: 23,
    numberOfLayer1Txs: '0x18',
    priorityOperationsHash: ('0x' + '08'.repeat(32)) as `0x${string}`,
    dependencyRootsRollingHash: ('0x' + '09'.repeat(32)) as `0x${string}`,
    l2ToL1LogsRootHash: ('0x' + '0a'.repeat(32)) as `0x${string}`,
    commitment: ('0x' + '0b'.repeat(32)) as `0x${string}`,
  },
} as const;

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

describe('rpc/zks.normalizeStorageProof', () => {
  it('normalizes existing storage proofs into camel-cased bigint fields', () => {
    const normalized = normalizeStorageProof(existingStorageProofResponse);

    expect(normalized).toEqual({
      address: storageProofAddress,
      stateCommitmentPreimage: {
        nextFreeSlot: 16n,
        blockNumber: 11n,
        last256BlockHashesBlake:
          existingStorageProofResponse.state_commitment_preimage.last256_block_hashes_blake,
        lastBlockTimestamp: 12n,
      },
      storageProofs: [
        {
          key: storageProofKey,
          proof: {
            type: 'existing',
            index: 2n,
            value: existingStorageProofResponse.storage_proofs[0].proof.value,
            nextIndex: 3n,
            siblings: existingStorageProofResponse.storage_proofs[0].proof.siblings,
          },
        },
      ],
      l1VerificationData: {
        batchNumber: 4n,
        numberOfLayer1Txs: 5n,
        priorityOperationsHash:
          existingStorageProofResponse.l1_verification_data.priority_operations_hash,
        dependencyRootsRollingHash:
          existingStorageProofResponse.l1_verification_data.dependency_roots_rolling_hash,
        l2ToL1LogsRootHash:
          existingStorageProofResponse.l1_verification_data.l2_to_l1_logs_root_hash,
        commitment: existingStorageProofResponse.l1_verification_data.commitment,
      },
    });
  });

  it('normalizes non-existing storage proofs and accepts snake/camel aliases', () => {
    const normalized = normalizeStorageProof(nonExistingStorageProofResponse);

    expect(normalized).toEqual({
      address: storageProofAddress,
      stateCommitmentPreimage: {
        nextFreeSlot: 20n,
        blockNumber: 21n,
        last256BlockHashesBlake:
          nonExistingStorageProofResponse.stateCommitmentPreimage.last256BlockHashesBlake,
        lastBlockTimestamp: 22n,
      },
      storageProofs: [
        {
          key: nonExistingStorageProofResponse.storageProofs[0].key,
          proof: {
            type: 'nonExisting',
            leftNeighbor: {
              index: 7n,
              leafKey:
                nonExistingStorageProofResponse.storageProofs[0].proof.left_neighbor.leaf_key,
              value: nonExistingStorageProofResponse.storageProofs[0].proof.left_neighbor.value,
              nextIndex: 8n,
              siblings:
                nonExistingStorageProofResponse.storageProofs[0].proof.left_neighbor.siblings,
            },
            rightNeighbor: {
              index: 9n,
              leafKey: nonExistingStorageProofResponse.storageProofs[0].proof.rightNeighbor.leafKey,
              value: nonExistingStorageProofResponse.storageProofs[0].proof.rightNeighbor.value,
              nextIndex: 10n,
              siblings:
                nonExistingStorageProofResponse.storageProofs[0].proof.rightNeighbor.siblings,
            },
          },
        },
      ],
      l1VerificationData: {
        batchNumber: 23n,
        numberOfLayer1Txs: 24n,
        priorityOperationsHash:
          nonExistingStorageProofResponse.l1VerificationData.priorityOperationsHash,
        dependencyRootsRollingHash:
          nonExistingStorageProofResponse.l1VerificationData.dependencyRootsRollingHash,
        l2ToL1LogsRootHash: nonExistingStorageProofResponse.l1VerificationData.l2ToL1LogsRootHash,
        commitment: nonExistingStorageProofResponse.l1VerificationData.commitment,
      },
    });
  });

  it('throws ZKsyncError for malformed top-level responses', () => {
    try {
      normalizeStorageProof(null);
      throw new Error('expected to throw');
    } catch (e) {
      expect(isZKsyncError(e)).toBe(true);
      expect(String(e)).toContain('Malformed storage proof response');
    }
  });

  it('throws ZKsyncError for malformed existing proof entries', () => {
    try {
      normalizeStorageProof({
        ...existingStorageProofResponse,
        storage_proofs: [
          { key: storageProofKey, proof: { type: 'existing', index: 1, value: '0x1' } },
        ],
      });
      throw new Error('expected to throw');
    } catch (e) {
      expect(isZKsyncError(e)).toBe(true);
      expect(String(e)).toContain('Malformed storage proof response');
    }
  });

  it('throws ZKsyncError for malformed non-existing proof entries', () => {
    try {
      normalizeStorageProof({
        ...nonExistingStorageProofResponse,
        storageProofs: [{ key: storageProofKey, proof: { type: 'nonExisting', leftNeighbor: {} } }],
      });
      throw new Error('expected to throw');
    } catch (e) {
      expect(isZKsyncError(e)).toBe(true);
      expect(String(e)).toContain('Malformed storage proof response');
    }
  });

  it('throws ZKsyncError for malformed neighbor leaf shapes', () => {
    try {
      normalizeStorageProof({
        ...nonExistingStorageProofResponse,
        storageProofs: [
          {
            ...nonExistingStorageProofResponse.storageProofs[0],
            proof: {
              type: 'nonExisting',
              leftNeighbor: {
                index: 1,
                value: ('0x' + '12'.repeat(32)) as `0x${string}`,
                nextIndex: 2,
                siblings: [],
              },
              rightNeighbor: nonExistingStorageProofResponse.storageProofs[0].proof.rightNeighbor,
            },
          },
        ],
      });
      throw new Error('expected to throw');
    } catch (e) {
      expect(isZKsyncError(e)).toBe(true);
      expect(String(e)).toContain('Malformed storage proof response');
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
    };
    const rpc = createZksRpc(fakeTransport({ zks_getL2ToL1LogProof: () => proof }));
    const out = await rpc.getL2ToL1LogProof(('0x' + 'aa'.repeat(32)) as `0x${string}`, 0);
    expect(out).toEqual({ id: 5n, batchNumber: 10n, proof: proof.proof });
  });

  it('throws STATE error when proof is unavailable (null/undefined/falsey)', () => {
    const rpc = createZksRpc(fakeTransport({ zks_getL2ToL1LogProof: null }));
    return expect(
      rpc.getL2ToL1LogProof(('0x' + 'bb'.repeat(32)) as `0x${string}`, 1),
    ).rejects.toThrow(/Proof not yet available/);
  });
});

describe('rpc/zks.getProof', () => {
  it('returns normalized storage proof on success', async () => {
    const rpc = createZksRpc(fakeTransport({ zks_getProof: () => existingStorageProofResponse }));
    const out = await rpc.getProof(storageProofAddress, [storageProofKey], 4);

    expect(out.storageProofs[0]).toEqual({
      key: storageProofKey,
      proof: {
        type: 'existing',
        index: 2n,
        value: existingStorageProofResponse.storage_proofs[0].proof.value,
        nextIndex: 3n,
        siblings: existingStorageProofResponse.storage_proofs[0].proof.siblings,
      },
    });
    expect(out.l1VerificationData.batchNumber).toBe(4n);
  });

  it('throws STATE error when the storage proof is unavailable', () => {
    const rpc = createZksRpc(fakeTransport({ zks_getProof: null }));
    return expect(rpc.getProof(storageProofAddress, [storageProofKey], 4)).rejects.toThrow(
      /Storage proof not yet available/,
    );
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
