// src/core/rpc/zks.ts

import type {
  RpcTransport,
  ReceiptWithL2ToL1,
  ProofNormalized,
  GenesisInput,
  GenesisContractDeployment,
  GenesisStorageEntry,
} from './types';
import type { Hex, Address } from '../types/primitives';
import { createError, shapeCause } from '../errors/factory';
import { withRpcOp } from '../errors/rpc';
import { isZKsyncError, type Resource } from '../types/errors';

/** ZKsync-specific RPC methods. */
export interface ZksRpc {
  // Fetches the Bridgehub contract address.
  getBridgehubAddress(): Promise<Address>;

  // Fetches a proof for an L2→L1 log emitted in the given transaction.
  getL2ToL1LogProof(txHash: Hex, index: number): Promise<ProofNormalized>;

  // Fetches the transaction receipt, including the `l2ToL1Logs` field.
  getReceiptWithL2ToL1(txHash: Hex): Promise<ReceiptWithL2ToL1 | null>;

  // Fetches the genesis configuration returned by `zks_getGenesis`.
  getGenesis(): Promise<GenesisInput>;
}

const METHODS = {
  getBridgehub: 'zks_getBridgehubContract',
  getL2ToL1LogProof: 'zks_getL2ToL1LogProof',
  getReceipt: 'eth_getTransactionReceipt',
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
      typeof x === 'bigint'
        ? x
        : typeof x === 'number'
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

    const rootRaw = raw?.root ?? raw?.root_hash;
    const root =
      rootRaw == null
        ? undefined
        : typeof rootRaw === 'string' && rootRaw.startsWith('0x')
          ? (rootRaw as Hex)
          : (() => {
              throw createError('RPC', {
                resource: 'zksrpc' as Resource,
                operation: 'zksrpc.normalizeProof',
                message: 'Malformed proof: invalid root field.',
                context: { valueType: typeof rootRaw },
              });
            })();

    return {
      id: toBig(idRaw),
      batchNumber: toBig(bnRaw),
      proof: toHexArray(raw?.proof),
      ...(root ? { root } : {}),
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

function ensureHex(value: unknown, field: string, context: Record<string, unknown>): Hex {
  if (typeof value === 'string' && value.startsWith('0x')) return value as Hex;
  throw createError('RPC', {
    resource: 'zksrpc' as Resource,
    operation: 'zksrpc.normalizeGenesis',
    message: 'Malformed genesis response: expected 0x-prefixed hex value.',
    context: { field, valueType: typeof value, ...context },
  });
}

function ensureNumber(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw createError('RPC', {
    resource: 'zksrpc' as Resource,
    operation: 'zksrpc.normalizeGenesis',
    message: 'Malformed genesis response: expected numeric value.',
    context: { field, valueType: typeof value },
  });
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

function normalizeStorageTuple(tuple: unknown, index: number): GenesisStorageEntry {
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
    key: ensureHex(keyRaw, 'additional_storage.key', { index }),
    value: ensureHex(valueRaw, 'additional_storage.value', { index }),
  };
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

    const storageRaw = record['additional_storage'];
    if (!Array.isArray(storageRaw)) {
      throw createError('RPC', {
        resource: 'zksrpc' as Resource,
        operation: 'zksrpc.normalizeGenesis',
        message: 'Malformed genesis response: additional_storage must be an array.',
        context: { valueType: typeof storageRaw },
      });
    }

    const executionVersion = ensureNumber(record['execution_version'], 'execution_version');
    const genesisRoot = ensureHex(record['genesis_root'], 'genesis_root', {});

    const initialContracts = contractsRaw.map((entry, index) =>
      normalizeContractTuple(entry, index),
    );
    const additionalStorage = storageRaw.map((entry, index) => normalizeStorageTuple(entry, index));

    return {
      initialContracts,
      additionalStorage,
      executionVersion,
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
