// src/core/rpc/zks.ts

import type {
  RpcTransport,
  ReceiptWithL2ToL1,
  ProofNormalized,
  BatchStorageProof,
  GenesisInput,
  GenesisContractDeployment,
  GenesisStorageEntry,
  BlockMetadata,
  ExistingStorageProof,
  L1VerificationData,
  LeafWithProof,
  NonExistingStorageProof,
  StateCommitmentPreimage,
  StorageProofEntry,
} from './types';
import type { Hex, Address } from '../types/primitives';
import { createError, shapeCause } from '../errors/factory';
import { withRpcOp } from '../errors/rpc';
import { isZKsyncError, type Resource } from '../types/errors';
import { isBigint, isNumber } from '../utils';

/** ZKsync-specific RPC methods. */
export interface ZksRpc {
  // Fetches the Bridgehub contract address.
  getBridgehubAddress(): Promise<Address>;

  // Fetches the Bytecode Supplier contract address.
  getBytecodeSupplierAddress(): Promise<Address>;

  // Fetches a proof for an L2→L1 log emitted in the given transaction.
  getL2ToL1LogProof(txHash: Hex, index: number): Promise<ProofNormalized>;

  // Fetches storage slot proofs rooted in an L1 batch commitment.
  getProof(address: Address, keys: Hex[], l1BatchNumber: number): Promise<BatchStorageProof>;

  // Fetches the transaction receipt, including the `l2ToL1Logs` field.
  getReceiptWithL2ToL1(txHash: Hex): Promise<ReceiptWithL2ToL1 | null>;

  // Fetches block metadata for the given block number.
  getBlockMetadataByNumber(blockNumber: number): Promise<BlockMetadata | null>;

  // Fetches the genesis configuration returned by `zks_getGenesis`.
  getGenesis(): Promise<GenesisInput>;
}

const METHODS = {
  getBridgehub: 'zks_getBridgehubContract',
  getL2ToL1LogProof: 'zks_getL2ToL1LogProof',
  getProof: 'zks_getProof',
  getReceipt: 'eth_getTransactionReceipt',
  getBytecodeSupplier: 'zks_getBytecodeSupplierContract',
  getBlockMetadataByNumber: 'zks_getBlockMetadataByNumber',
  getGenesis: 'zks_getGenesis',
} as const;

// TODO: move to utils
function toHexArray(arr: unknown): Hex[] {
  const list = Array.isArray(arr) ? (arr as unknown[]) : [];
  return list.map((x) => x as Hex);
}

// TODO: better validation
// normalize proof response into consistent shape
export function normalizeProof(p: unknown): ProofNormalized {
  try {
    const raw = (p ?? {}) as Record<string, unknown>;
    const idRaw = raw?.id ?? raw?.index;
    const bnRaw = raw?.batch_number ?? raw?.batchNumber;
    if (idRaw == null || bnRaw == null) {
      throw createError('RPC', {
        resource: 'zksrpc' as Resource,
        operation: 'zksrpc.normalizeProof',
        message: 'Malformed proof: missing id or batch number.',

        context: { keys: Object.keys(raw ?? {}) },
      });
    }

    const toBig = (x: unknown) =>
      isBigint(x)
        ? x
        : isNumber(x)
          ? BigInt(x)
          : typeof x === 'string'
            ? BigInt(x)
            : (() => {
                throw createError('RPC', {
                  resource: 'zksrpc' as Resource,
                  operation: 'zksrpc.normalizeProof',
                  message: 'Malformed proof: invalid numeric field.',
                  context: { valueType: typeof x },
                });
              })();

    return {
      id: toBig(idRaw),
      batchNumber: toBig(bnRaw),
      proof: toHexArray(raw?.proof),
      root: raw.root as Hex,
    };
  } catch (e) {
    if (isZKsyncError(e)) throw e;
    throw createError('RPC', {
      resource: 'zksrpc' as Resource,
      operation: 'zksrpc.normalizeProof',
      message: 'Failed to normalize proof.',
      context: { receivedType: typeof p },
      cause: shapeCause(e),
    });
  }
}

function ensureHex(
  value: unknown,
  field: string,
  context: Record<string, unknown>,
  opts?: { operation: string; messagePrefix: string },
): Hex {
  const operation = opts?.operation ?? 'zksrpc.normalizeGenesis';
  const messagePrefix = opts?.messagePrefix ?? 'Malformed genesis response';

  if (typeof value === 'string' && value.startsWith('0x')) return value as Hex;
  throw createError('RPC', {
    resource: 'zksrpc' as Resource,
    operation,
    message: `${messagePrefix}: expected 0x-prefixed hex value.`,
    context: { field, valueType: typeof value, ...context },
  });
}

// Core RPC stays adapter-agnostic; these helpers normalize RPC scalars without viem/ethers deps.
// We keep small, local parsers here so `createZksRpc` can expose a stable typed surface.
function ensureNumber(
  value: unknown,
  field: string,
  opts?: { operation: string; messagePrefix: string },
): number {
  const operation = opts?.operation ?? 'zksrpc.normalizeGenesis';
  const messagePrefix = opts?.messagePrefix ?? 'Malformed genesis response';

  if (isNumber(value)) return value;
  if (isBigint(value)) return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw createError('RPC', {
    resource: 'zksrpc' as Resource,
    operation,
    message: `${messagePrefix}: expected numeric value.`,
    context: { field, valueType: typeof value },
  });
}

// BigInt parsing mirrors JSON-RPC quantities (hex strings), but stays dependency-free in core/.
// Adapter helpers like viem/ethers are not available here by design.
function ensureBigInt(
  value: unknown,
  field: string,
  opts?: { operation: string; messagePrefix: string },
): bigint {
  const operation = opts?.operation ?? 'zksrpc.normalizeBlockMetadata';
  const messagePrefix = opts?.messagePrefix ?? 'Malformed block metadata response';

  if (isBigint(value)) return value;
  if (isNumber(value)) {
    if (!Number.isInteger(value)) {
      throw createError('RPC', {
        resource: 'zksrpc' as Resource,
        operation,
        message: `${messagePrefix}: expected integer value.`,
        context: { field, valueType: typeof value },
      });
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return BigInt(value);
    } catch {
      // fall through to error
    }
  }

  throw createError('RPC', {
    resource: 'zksrpc' as Resource,
    operation,
    message: `${messagePrefix}: expected bigint-compatible value.`,
    context: { field, valueType: typeof value },
  });
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (hasOwn(record, key)) return record[key];
  }
  return undefined;
}

function ensureRecord(
  value: unknown,
  field: string,
  opts: { operation: string; messagePrefix: string; context?: Record<string, unknown> },
): Record<string, unknown> {
  if (isRecord(value)) return value;

  throw createError('RPC', {
    resource: 'zksrpc' as Resource,
    operation: opts.operation,
    message: `${opts.messagePrefix}: expected object.`,
    context: { field, valueType: typeof value, ...(opts.context ?? {}) },
  });
}

function ensureHexArray(
  value: unknown,
  field: string,
  opts: { operation: string; messagePrefix: string; context?: Record<string, unknown> },
): Hex[] {
  if (!Array.isArray(value)) {
    throw createError('RPC', {
      resource: 'zksrpc' as Resource,
      operation: opts.operation,
      message: `${opts.messagePrefix}: expected array.`,
      context: { field, valueType: typeof value, ...(opts.context ?? {}) },
    });
  }

  return value.map((entry, index) =>
    ensureHex(entry, `${field}[${index}]`, opts.context ?? {}, opts),
  );
}

function normalizeStateCommitmentPreimage(raw: unknown): StateCommitmentPreimage {
  const operation = 'zksrpc.normalizeStorageProof';
  const messagePrefix = 'Malformed storage proof response';
  const record = ensureRecord(raw, 'stateCommitmentPreimage', { operation, messagePrefix });

  return {
    nextFreeSlot: ensureBigInt(
      pick(record, 'nextFreeSlot', 'next_free_slot'),
      'stateCommitmentPreimage.nextFreeSlot',
      { operation, messagePrefix },
    ),
    blockNumber: ensureBigInt(
      pick(record, 'blockNumber', 'block_number'),
      'stateCommitmentPreimage.blockNumber',
      { operation, messagePrefix },
    ),
    last256BlockHashesBlake: ensureHex(
      pick(record, 'last256BlockHashesBlake', 'last256_block_hashes_blake'),
      'stateCommitmentPreimage.last256BlockHashesBlake',
      {},
      { operation, messagePrefix },
    ),
    lastBlockTimestamp: ensureBigInt(
      pick(record, 'lastBlockTimestamp', 'last_block_timestamp'),
      'stateCommitmentPreimage.lastBlockTimestamp',
      { operation, messagePrefix },
    ),
  };
}

function normalizeL1VerificationData(raw: unknown): L1VerificationData {
  const operation = 'zksrpc.normalizeStorageProof';
  const messagePrefix = 'Malformed storage proof response';
  const record = ensureRecord(raw, 'l1VerificationData', { operation, messagePrefix });

  return {
    batchNumber: ensureBigInt(
      pick(record, 'batchNumber', 'batch_number'),
      'l1VerificationData.batchNumber',
      { operation, messagePrefix },
    ),
    numberOfLayer1Txs: ensureBigInt(
      pick(record, 'numberOfLayer1Txs', 'number_of_layer1_txs'),
      'l1VerificationData.numberOfLayer1Txs',
      { operation, messagePrefix },
    ),
    priorityOperationsHash: ensureHex(
      pick(record, 'priorityOperationsHash', 'priority_operations_hash'),
      'l1VerificationData.priorityOperationsHash',
      {},
      { operation, messagePrefix },
    ),
    dependencyRootsRollingHash: ensureHex(
      pick(record, 'dependencyRootsRollingHash', 'dependency_roots_rolling_hash'),
      'l1VerificationData.dependencyRootsRollingHash',
      {},
      { operation, messagePrefix },
    ),
    l2ToL1LogsRootHash: ensureHex(
      pick(record, 'l2ToL1LogsRootHash', 'l2_to_l1_logs_root_hash'),
      'l1VerificationData.l2ToL1LogsRootHash',
      {},
      { operation, messagePrefix },
    ),
    commitment: ensureHex(
      pick(record, 'commitment'),
      'l1VerificationData.commitment',
      {},
      {
        operation,
        messagePrefix,
      },
    ),
  };
}

function normalizeLeafWithProof(raw: unknown, field: string): LeafWithProof {
  const operation = 'zksrpc.normalizeStorageProof';
  const messagePrefix = 'Malformed storage proof response';
  const record = ensureRecord(raw, field, { operation, messagePrefix });

  return {
    index: ensureBigInt(pick(record, 'index'), `${field}.index`, { operation, messagePrefix }),
    leafKey: ensureHex(
      pick(record, 'leafKey', 'leaf_key'),
      `${field}.leafKey`,
      {},
      {
        operation,
        messagePrefix,
      },
    ),
    value: ensureHex(pick(record, 'value'), `${field}.value`, {}, { operation, messagePrefix }),
    nextIndex: ensureBigInt(pick(record, 'nextIndex', 'next_index'), `${field}.nextIndex`, {
      operation,
      messagePrefix,
    }),
    siblings: ensureHexArray(pick(record, 'siblings'), `${field}.siblings`, {
      operation,
      messagePrefix,
    }),
  };
}

function normalizeExistingStorageProof(raw: unknown): ExistingStorageProof {
  const operation = 'zksrpc.normalizeStorageProof';
  const messagePrefix = 'Malformed storage proof response';
  const record = ensureRecord(raw, 'proof', { operation, messagePrefix });

  return {
    type: 'existing',
    index: ensureBigInt(pick(record, 'index'), 'proof.index', { operation, messagePrefix }),
    value: ensureHex(pick(record, 'value'), 'proof.value', {}, { operation, messagePrefix }),
    nextIndex: ensureBigInt(pick(record, 'nextIndex', 'next_index'), 'proof.nextIndex', {
      operation,
      messagePrefix,
    }),
    siblings: ensureHexArray(pick(record, 'siblings'), 'proof.siblings', {
      operation,
      messagePrefix,
    }),
  };
}

function normalizeNonExistingStorageProof(raw: unknown): NonExistingStorageProof {
  const operation = 'zksrpc.normalizeStorageProof';
  const messagePrefix = 'Malformed storage proof response';
  const record = ensureRecord(raw, 'proof', { operation, messagePrefix });

  return {
    type: 'nonExisting',
    leftNeighbor: normalizeLeafWithProof(
      pick(record, 'leftNeighbor', 'left_neighbor'),
      'proof.leftNeighbor',
    ),
    rightNeighbor: normalizeLeafWithProof(
      pick(record, 'rightNeighbor', 'right_neighbor'),
      'proof.rightNeighbor',
    ),
  };
}

function normalizeStorageProofEntry(raw: unknown, index: number): StorageProofEntry {
  const operation = 'zksrpc.normalizeStorageProof';
  const messagePrefix = 'Malformed storage proof response';
  const record = ensureRecord(raw, 'storageProofs[]', {
    operation,
    messagePrefix,
    context: { index },
  });
  const proof = ensureRecord(pick(record, 'proof'), 'storageProofs.proof', {
    operation,
    messagePrefix,
    context: { index },
  });
  const type = pick(proof, 'type');

  if (type !== 'existing' && type !== 'nonExisting') {
    throw createError('RPC', {
      resource: 'zksrpc' as Resource,
      operation,
      message: `${messagePrefix}: unsupported proof type.`,
      context: { index, value: type },
    });
  }

  return {
    key: ensureHex(
      pick(record, 'key'),
      `storageProofs[${index}].key`,
      {},
      {
        operation,
        messagePrefix,
      },
    ),
    proof:
      type === 'existing'
        ? normalizeExistingStorageProof(proof)
        : normalizeNonExistingStorageProof(proof),
  };
}

export function normalizeStorageProof(raw: unknown): BatchStorageProof {
  try {
    const operation = 'zksrpc.normalizeStorageProof';
    const messagePrefix = 'Malformed storage proof response';
    const record = ensureRecord(raw, 'response', { operation, messagePrefix });
    const storageProofsRaw = pick(record, 'storageProofs', 'storage_proofs');

    if (!Array.isArray(storageProofsRaw)) {
      throw createError('RPC', {
        resource: 'zksrpc' as Resource,
        operation,
        message: `${messagePrefix}: expected array.`,
        context: {
          field: 'storageProofs',
          valueType: typeof storageProofsRaw,
        },
      });
    }

    return {
      address: ensureHex(pick(record, 'address'), 'address', {}, { operation, messagePrefix }),
      stateCommitmentPreimage: normalizeStateCommitmentPreimage(
        pick(record, 'stateCommitmentPreimage', 'state_commitment_preimage'),
      ),
      storageProofs: storageProofsRaw.map((entry, index) =>
        normalizeStorageProofEntry(entry, index),
      ),
      l1VerificationData: normalizeL1VerificationData(
        pick(record, 'l1VerificationData', 'l1_verification_data'),
      ),
    };
  } catch (e) {
    if (isZKsyncError(e)) throw e;
    throw createError('RPC', {
      resource: 'zksrpc' as Resource,
      operation: 'zksrpc.normalizeStorageProof',
      message: 'Failed to normalize storage proof response.',
      context: { receivedType: typeof raw },
      cause: shapeCause(e),
    });
  }
}

function normalizeContractTuple(tuple: unknown, index: number): GenesisContractDeployment {
  if (!Array.isArray(tuple) || tuple.length < 2) {
    throw createError('RPC', {
      resource: 'zksrpc' as Resource,
      operation: 'zksrpc.normalizeGenesis',
      message: 'Malformed genesis response: invalid contract tuple.',
      context: { index, valueType: typeof tuple },
    });
  }

  const [addrRaw, bytecodeRaw] = tuple as [unknown, unknown];
  return {
    address: ensureHex(addrRaw, 'initial_contracts.address', { index }),
    bytecode: ensureHex(bytecodeRaw, 'initial_contracts.bytecode', { index }),
  };
}

// Normalizes a "raw" storage entry tuple: [key, value]
function normalizeRawStorageTuple(
  tuple: unknown,
  index: number,
): Extract<GenesisStorageEntry, { format: 'raw' }> {
  if (!Array.isArray(tuple) || tuple.length < 2) {
    throw createError('RPC', {
      resource: 'zksrpc' as Resource,
      operation: 'zksrpc.normalizeGenesis',
      message: 'Malformed genesis response: invalid storage tuple.',
      context: { index, valueType: typeof tuple },
    });
  }

  const [keyRaw, valueRaw] = tuple as [unknown, unknown];
  return {
    format: 'raw' as const,
    key: ensureHex(keyRaw, 'additional_storage.key', { index }),
    value: ensureHex(valueRaw, 'additional_storage.value', { index }),
  };
}

// Normalizes additional storage entries from either "raw" or "pretty" format.
function normalizeAdditionalStorage(
  value: unknown,
  record: Record<string, unknown>,
): GenesisStorageEntry[] {
  const effective = value ?? record['additional_storage_raw'];

  // Raw tuple format: [[key, value], ...]
  if (Array.isArray(effective)) {
    return effective.map((entry, index) => {
      const kv = normalizeRawStorageTuple(entry, index);
      return { format: 'raw' as const, key: kv.key, value: kv.value };
    });
  }

  // Pretty format: { [address]: { [slot]: value } }
  if (isRecord(effective)) {
    const out: GenesisStorageEntry[] = [];
    for (const [addrRaw, slotsRaw] of Object.entries(effective)) {
      const address = ensureHex(addrRaw, 'additional_storage.address', {});

      if (!isRecord(slotsRaw)) {
        throw createError('RPC', {
          resource: 'zksrpc' as Resource,
          operation: 'zksrpc.normalizeGenesis',
          message: 'Malformed genesis response: additional_storage[address] must be an object map.',
          context: { address, valueType: typeof slotsRaw },
        });
      }

      for (const [slotRaw, valRaw] of Object.entries(slotsRaw)) {
        out.push({
          format: 'pretty' as const,
          address,
          key: ensureHex(slotRaw, 'additional_storage.key', { address }),
          value: ensureHex(valRaw, 'additional_storage.value', { address, key: slotRaw }),
        });
      }
    }
    return out;
  }

  throw createError('RPC', {
    resource: 'zksrpc' as Resource,
    operation: 'zksrpc.normalizeGenesis',
    message:
      'Malformed genesis response: additional_storage must be an array (raw) or an object map (pretty).',
    context: {
      valueType: typeof effective,
      hasAdditionalStorage: 'additional_storage' in record,
      hasAdditionalStorageRaw: 'additional_storage_raw' in record,
    },
  });
}

// Normalizes the genesis response into camel-cased fields and typed entries.
export function normalizeGenesis(raw: unknown): GenesisInput {
  try {
    if (!raw || typeof raw !== 'object') {
      throw createError('RPC', {
        resource: 'zksrpc' as Resource,
        operation: 'zksrpc.normalizeGenesis',
        message: 'Malformed genesis response: expected object.',
        context: { receivedType: typeof raw },
      });
    }

    const record = raw as Record<string, unknown>;

    const contractsRaw = record['initial_contracts'];
    if (!Array.isArray(contractsRaw)) {
      throw createError('RPC', {
        resource: 'zksrpc' as Resource,
        operation: 'zksrpc.normalizeGenesis',
        message: 'Malformed genesis response: initial_contracts must be an array.',
        context: { valueType: typeof contractsRaw },
      });
    }

    const genesisRoot = ensureHex(record['genesis_root'], 'genesis_root', {});

    const initialContracts = contractsRaw.map((entry, index) =>
      normalizeContractTuple(entry, index),
    );

    const additionalStorage = normalizeAdditionalStorage(record['additional_storage'], record);

    return {
      initialContracts,
      additionalStorage,
      genesisRoot,
    };
  } catch (e) {
    if (isZKsyncError(e)) throw e;
    throw createError('RPC', {
      resource: 'zksrpc' as Resource,
      operation: 'zksrpc.normalizeGenesis',
      message: 'Failed to normalize genesis response.',
      context: { receivedType: typeof raw },
      cause: shapeCause(e),
    });
  }
}

// Normalizes block metadata response into camel-cased fields.
export function normalizeBlockMetadata(raw: unknown): BlockMetadata {
  try {
    if (!raw || typeof raw !== 'object') {
      throw createError('RPC', {
        resource: 'zksrpc' as Resource,
        operation: 'zksrpc.normalizeBlockMetadata',
        message: 'Malformed block metadata response: expected object.',
        context: { receivedType: typeof raw },
      });
    }

    const record = raw as Record<string, unknown>;
    const pubdataPricePerByte = ensureBigInt(
      record['pubdata_price_per_byte'] ?? record['pubdataPricePerByte'],
      'pubdata_price_per_byte',
      {
        operation: 'zksrpc.normalizeBlockMetadata',
        messagePrefix: 'Malformed block metadata response',
      },
    );
    const nativePrice = ensureBigInt(
      record['native_price'] ?? record['nativePrice'],
      'native_price',
      {
        operation: 'zksrpc.normalizeBlockMetadata',
        messagePrefix: 'Malformed block metadata response',
      },
    );
    const executionVersion = ensureNumber(
      record['execution_version'] ?? record['executionVersion'],
      'execution_version',
      {
        operation: 'zksrpc.normalizeBlockMetadata',
        messagePrefix: 'Malformed block metadata response',
      },
    );

    return {
      pubdataPricePerByte,
      nativePrice,
      executionVersion,
    };
  } catch (e) {
    if (isZKsyncError(e)) throw e;
    throw createError('RPC', {
      resource: 'zksrpc' as Resource,
      operation: 'zksrpc.normalizeBlockMetadata',
      message: 'Failed to normalize block metadata response.',
      context: { receivedType: typeof raw },
      cause: shapeCause(e),
    });
  }
}

// Constructs a ZksRpc instance using the given transport function.
export function createZksRpc(transport: RpcTransport): ZksRpc {
  return {
    // Fetches the Bridgehub contract address.
    async getBridgehubAddress() {
      return withRpcOp(
        'zksrpc.getBridgehubAddress',
        'Failed to fetch Bridgehub address.',
        {},
        async () => {
          const addrRaw = (await transport(METHODS.getBridgehub, [])) as unknown;
          // Validate response shape
          if (typeof addrRaw !== 'string' || !addrRaw.startsWith('0x')) {
            throw createError('RPC', {
              resource: 'zksrpc' as Resource,
              operation: 'zksrpc.getBridgehubAddress',
              message: 'Unexpected Bridgehub address response.',
              context: { valueType: typeof addrRaw },
            });
          }
          return addrRaw as Address;
        },
      );
    },

    // Fetches the Bytecode Supplier contract address.
    async getBytecodeSupplierAddress() {
      return withRpcOp(
        'zksrpc.getBytecodeSupplierAddress',
        'Failed to fetch Bytecode Supplier address.',
        {},
        async () => {
          const addrRaw = (await transport(METHODS.getBytecodeSupplier, [])) as unknown;
          if (typeof addrRaw !== 'string' || !addrRaw.startsWith('0x')) {
            throw createError('RPC', {
              resource: 'zksrpc' as Resource,
              operation: 'zksrpc.getBytecodeSupplierAddress',
              message: 'Unexpected Bytecode Supplier address response.',
              context: { valueType: typeof addrRaw },
            });
          }
          return addrRaw as Address;
        },
      );
    },

    // Fetches a proof for an L2→L1 log emitted in the given transaction.
    async getL2ToL1LogProof(txHash, index) {
      return withRpcOp(
        'zksrpc.getL2ToL1LogProof',
        'Failed to fetch L2→L1 log proof.',
        { txHash, index },
        async () => {
          const proof: unknown = await transport(METHODS.getL2ToL1LogProof, [txHash, index]);
          if (!proof) {
            throw createError('STATE', {
              resource: 'zksrpc' as Resource,
              operation: 'zksrpc.getL2ToL1LogProof',
              message: 'Proof not yet available. Please try again later.',
              context: { txHash, index },
            });
          }
          return normalizeProof(proof);
        },
      );
    },

    // Fetches storage slot proofs rooted in an L1 batch commitment.
    async getProof(address, keys, l1BatchNumber) {
      return withRpcOp(
        'zksrpc.getProof',
        'Failed to fetch storage proof.',
        { address, keys, l1BatchNumber },
        async () => {
          const proof: unknown = await transport(METHODS.getProof, [address, keys, l1BatchNumber]);
          if (!proof) {
            throw createError('STATE', {
              resource: 'zksrpc' as Resource,
              operation: 'zksrpc.getProof',
              message: 'Storage proof not yet available. Please try again later.',
              context: { address, keys, l1BatchNumber },
            });
          }
          return normalizeStorageProof(proof);
        },
      );
    },

    // Fetches the transaction receipt, including the `l2ToL1Logs` field.
    async getReceiptWithL2ToL1(txHash) {
      return withRpcOp(
        'zksrpc.getReceiptWithL2ToL1',
        'Failed to fetch transaction receipt.',
        { txHash },
        async () => {
          const rcptRaw: unknown = await transport(METHODS.getReceipt, [txHash]);
          if (!rcptRaw) return null;
          const rcptObj = rcptRaw as Record<string, unknown>;
          // ensure l2ToL1Logs is always an array
          const logs = Array.isArray(rcptObj['l2ToL1Logs'])
            ? (rcptObj['l2ToL1Logs'] as unknown[])
            : [];
          rcptObj['l2ToL1Logs'] = logs;
          return rcptObj as ReceiptWithL2ToL1;
        },
      );
    },

    // Fetches block metadata for the given block number.
    async getBlockMetadataByNumber(blockNumber) {
      return withRpcOp(
        'zksrpc.getBlockMetadataByNumber',
        'Failed to fetch block metadata.',
        { blockNumber },
        async () => {
          const raw: unknown = await transport(METHODS.getBlockMetadataByNumber, [blockNumber]);
          if (raw == null) return null;
          return normalizeBlockMetadata(raw);
        },
      );
    },

    // Fetches the genesis configuration returned by `zks_getGenesis`.
    async getGenesis() {
      return withRpcOp(
        'zksrpc.getGenesis',
        'Failed to fetch genesis configuration.',
        {},
        async () => {
          const genesisRaw: unknown = await transport(METHODS.getGenesis, []);
          return normalizeGenesis(genesisRaw);
        },
      );
    },
  };
}
