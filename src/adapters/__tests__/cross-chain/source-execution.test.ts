import { describe, expect, it } from 'bun:test';
import type {
  AbstractProvider,
  Signer,
  TransactionReceipt as EthersTransactionReceipt,
  TransactionRequest,
} from 'ethers';
import type {
  Abi,
  Account,
  PublicClient,
  TransactionReceipt as ViemTransactionReceipt,
  WalletClient,
} from 'viem';

import { IERC20ABI } from '../../../core/abi';
import { executeSourcePlan } from '../../../core/internal/cross-chain/execution';
import type { Address, Hex } from '../../../core/types/primitives';
import { createEthersTransactionDriver } from '../../ethers/internal/source-execution';
import {
  createViemContractWriteDriver,
  createViemRawTransactionDriver,
} from '../../viem/internal/source-execution';

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const TARGET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
const TX_HASH = `0x${'11'.repeat(32)}` as Hex;
const account = { address: ACCOUNT, type: 'json-rpc' } as Account;

describe('ethers source transaction driver', () => {
  it('preserves explicit nonces, override precedence, and the prepared request', async () => {
    const nonceTags: string[] = [];
    const sent: TransactionRequest[] = [];
    const provider = {
      getTransactionCount: async (_address: string, blockTag: string) => {
        nonceTags.push(blockTag);
        return 20;
      },
      estimateGas: async () => 100n,
    } as unknown as AbstractProvider;
    const signer = {
      getAddress: async () => ACCOUNT,
      sendTransaction: async (request: TransactionRequest) => {
        sent.push(request);
        return {
          hash: TX_HASH,
          wait: async () => ({ status: 1 }) as EthersTransactionReceipt,
        };
      },
    } as unknown as Signer;
    const tx: TransactionRequest = { to: TARGET, gasLimit: 75n };

    const result = await executeSourcePlan({
      steps: [{ key: 'send', kind: 'send', description: 'Send', tx }],
      nonce: 9,
      driver: createEthersTransactionDriver({
        provider,
        signer,
        defaultNonceTag: 'latest',
        synchronizePendingNonce: true,
        overrides: {
          nonce: 9,
          gasLimit: 500n,
          maxFeePerGas: 8n,
          maxPriorityFeePerGas: 2n,
        },
        gasPolicy: {
          mode: 'always',
          resolveGasLimit: ({ estimatedGasLimit }) => estimatedGasLimit * 2n,
        },
        revertedError: () => new Error('reverted'),
        mapError: (error) => error as Error,
      }),
    });

    expect(nonceTags).toEqual(['pending']);
    expect(sent[0]).toMatchObject({
      to: TARGET,
      nonce: 9,
      gasLimit: 500n,
      maxFeePerGas: 8n,
      maxPriorityFeePerGas: 2n,
    });
    expect(tx).toEqual({ to: TARGET, gasLimit: 75n });
    expect(result.lastSourceReceipt?.status).toBe(1);
  });

  it('keeps prepared gas on estimation failure and maps reverted receipts', async () => {
    let sent: TransactionRequest | undefined;
    const driver = createEthersTransactionDriver({
      provider: {
        getTransactionCount: async () => 4,
        estimateGas: async () => {
          throw new Error('estimate failed');
        },
      } as unknown as AbstractProvider,
      signer: {
        getAddress: async () => ACCOUNT,
        sendTransaction: async (request: TransactionRequest) => {
          sent = request;
          return {
            hash: TX_HASH,
            wait: async () => ({ status: 0 }) as EthersTransactionReceipt,
          };
        },
      } as unknown as Signer,
      defaultNonceTag: 'pending',
      gasPolicy: {
        mode: 'always',
        resolveGasLimit: ({ estimatedGasLimit }) => estimatedGasLimit,
      },
      revertedError: () => new Error('receipt reverted'),
      mapError: (error) => new Error(`mapped: ${(error as Error).message}`),
    });

    await expect(
      executeSourcePlan({
        steps: [
          { key: 'send', kind: 'send', description: 'Send', tx: { to: TARGET, gasLimit: 77n } },
        ],
        driver,
      }),
    ).rejects.toThrow('mapped: receipt reverted');
    expect(sent?.gasLimit).toBe(77n);
  });
});

describe('viem source transaction drivers', () => {
  it('resolves nonce tags, buffers contract gas, and keeps plans immutable', async () => {
    const nonceTags: string[] = [];
    const writes: Array<Record<string, unknown>> = [];
    const publicClient = {
      getTransactionCount: async ({ blockTag }: { blockTag: string }) => {
        nonceTags.push(blockTag);
        return 3;
      },
      estimateContractGas: async () => 100n,
      waitForTransactionReceipt: async () =>
        ({ status: 'success', transactionHash: TX_HASH }) as ViemTransactionReceipt,
    } as unknown as PublicClient;
    const wallet = {
      writeContract: async (request: Record<string, unknown>) => {
        writes.push(request);
        return TX_HASH;
      },
    } as unknown as WalletClient;
    const tx = {
      address: TARGET,
      abi: IERC20ABI as Abi,
      functionName: 'approve',
      args: [TARGET, 1n] as const,
    };

    const result = await executeSourcePlan({
      steps: [{ key: 'approve', kind: 'approve', description: 'Approve', tx }],
      nonce: 'pending',
      driver: createViemContractWriteDriver({
        publicClient,
        wallet: wallet as never,
        account,
        defaultNonceTag: 'latest',
        gasPolicy: {
          mode: 'when-missing',
          resolveGasLimit: ({ estimatedGasLimit }) => (estimatedGasLimit * 115n) / 100n,
        },
        missingWalletError: () => new Error('missing wallet'),
        revertedError: () => new Error('reverted'),
        mapError: (error) => error as Error,
      }),
    });

    expect(nonceTags).toEqual(['pending']);
    expect(writes[0]).toMatchObject({ nonce: 3, gas: 115n, account });
    expect(tx).toEqual({
      address: TARGET,
      abi: IERC20ABI,
      functionName: 'approve',
      args: [TARGET, 1n],
    });
    expect(result.receipts.get('approve')?.status).toBe('success');
  });

  it('reports a missing contract wallet through the resource mapper', async () => {
    const publicClient = {
      getTransactionCount: async () => 1,
      estimateContractGas: async () => 100n,
    } as unknown as PublicClient;
    await expect(
      executeSourcePlan({
        steps: [
          {
            key: 'send',
            kind: 'send',
            description: 'Send',
            tx: { address: TARGET, abi: IERC20ABI as Abi, functionName: 'approve' },
          },
        ],
        nonce: 1,
        driver: createViemContractWriteDriver({
          publicClient,
          account,
          defaultNonceTag: 'pending',
          missingWalletError: () => new Error('missing wallet'),
          revertedError: () => new Error('reverted'),
          mapError: (error) => new Error(`mapped: ${(error as Error).message}`),
        }),
      }),
    ).rejects.toThrow('mapped: missing wallet');
  });

  it('keeps raw prepared gas on estimate failure and maps a reverted receipt', async () => {
    let sent: Record<string, unknown> | undefined;
    const publicClient = {
      getTransactionCount: async () => 1,
      estimateGas: async () => {
        throw new Error('estimate failed');
      },
      waitForTransactionReceipt: async () =>
        ({ status: 'reverted', transactionHash: TX_HASH }) as ViemTransactionReceipt,
    } as unknown as PublicClient;
    const wallet = {
      sendTransaction: async (request: Record<string, unknown>) => {
        sent = request;
        return TX_HASH;
      },
    } as unknown as WalletClient;

    await expect(
      executeSourcePlan({
        steps: [
          {
            key: 'send',
            kind: 'send',
            description: 'Send',
            tx: { to: TARGET, data: '0x1234' as Hex, gasLimit: 44n },
          },
        ],
        nonce: 7,
        driver: createViemRawTransactionDriver({
          publicClient,
          wallet: wallet as never,
          account,
          defaultNonceTag: 'pending',
          gasPolicy: {
            mode: 'when-missing',
            resolveGasLimit: ({ estimatedGasLimit }) => estimatedGasLimit,
          },
          missingWalletError: () => new Error('missing wallet'),
          revertedError: () => new Error('receipt reverted'),
          mapError: (error) => new Error(`mapped: ${(error as Error).message}`),
        }),
      }),
    ).rejects.toThrow('mapped: receipt reverted');
    expect(sent).toMatchObject({ nonce: 7, gas: 44n, data: '0x1234' });
  });
});
