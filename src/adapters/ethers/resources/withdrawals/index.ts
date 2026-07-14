// src/adapters/ethers/resources/withdrawals/index.ts
import { type TransactionRequest, type TransactionReceipt } from 'ethers';
import type { EthersClient } from '../../client';
import type {
  WithdrawParams,
  WithdrawQuote,
  WithdrawPlan,
  WithdrawHandle,
  WithdrawalWaitable,
  WithdrawRoute,
  WithdrawalStatus,
} from '../../../../core/types/flows/withdrawals';
import type { Hex } from '../../../../core/types/primitives';
import { commonCtx } from './context';
import { toZKsyncError } from '../../errors/error-ops';
import { createError } from '../../../../core/errors/factory';
import { isReceiptNotFound } from '../../../../core/types/errors';
import type { WithdrawRouteStrategy, TransactionReceiptZKsyncOS } from './routes/types';
import { routeEthBaseBundle, routeErc20NonBaseBundle } from './routes/bundle';
import { createFinalizationServices, type FinalizationServices } from './services/finalization';
import {
  createWithdrawalBundleFinalizationServices,
  type WithdrawalBundleFinalizationServices,
} from './services/bundle-finalization';
import { createErrorHandlers } from '../../errors/error-ops';
import { OP_WITHDRAWALS } from '../../../../core/types/errors';
import type { ReceiptWithL2ToL1 } from '../../../../core/rpc/types';
import { createTokensResource } from '../tokens';
import type { TokensResource } from '../../../../core/types/flows/token';
import { createContractsResource } from '../contracts';
import type { ContractsResource } from '../contracts';
import { executeSourcePlan } from '../../../../core/internal/cross-chain/execution';
import {
  finalizeWithdrawalBundleLifecycle,
  inspectWithdrawalBundleLifecycle,
  pollWithdrawalStatus,
} from '../../../../core/internal/cross-chain/withdrawal-lifecycle';
import { createEthersTransactionDriver } from '../../internal/source-execution';

// --------------------
// Withdrawal Route map
// --------------------
export const ROUTES: Record<WithdrawRoute, WithdrawRouteStrategy> = {
  base: routeEthBaseBundle(),
  'erc20-nonbase': routeErc20NonBaseBundle(),
};

export interface WithdrawalsResource {
  // Get a quote for a withdrawal operation
  quote(p: WithdrawParams): Promise<WithdrawQuote>;

  // Try to get a quote for a withdrawal operation
  tryQuote(
    p: WithdrawParams,
  ): Promise<{ ok: true; value: WithdrawQuote } | { ok: false; error: unknown }>;

  // Prepare a withdrawal plan (route + steps) without executing it
  prepare(p: WithdrawParams): Promise<WithdrawPlan<TransactionRequest>>;

  // Try to prepare a withdrawal plan without executing it
  tryPrepare(
    p: WithdrawParams,
  ): Promise<{ ok: true; value: WithdrawPlan<TransactionRequest> } | { ok: false; error: unknown }>;

  // Execute a withdrawal operation
  // Returns a handle that can be used to track the status of the withdrawal
  create(p: WithdrawParams): Promise<WithdrawHandle<TransactionRequest>>;

  // Try to execute a withdrawal operation
  tryCreate(
    p: WithdrawParams,
  ): Promise<
    { ok: true; value: WithdrawHandle<TransactionRequest> } | { ok: false; error: unknown }
  >;

  // Check the status of a withdrawal operation
  // If the handle has no L2 tx hash, returns { phase: 'UNKNOWN' }
  // If L2 tx not yet included, returns { phase: 'L2_PENDING', l2TxHash }
  // If L2 tx included but not yet finalizable, returns { phase: 'PENDING', l2TxHash }
  // If finalizable, returns { phase: 'READY_TO_FINALIZE', l2TxHash, key }
  // If finalized, returns { phase: 'FINALIZED', l2TxHash, key }
  status(h: WithdrawalWaitable | Hex): Promise<WithdrawalStatus>;

  // Wait until the withdrawal reaches the desired state
  // If the handle has no L2 tx hash, returns null immediately
  // If 'for' is 'l2', waits for L2 inclusion and returns the L2 receipt
  // If 'for' is 'ready', waits until finalization is possible (no side-effects) and returns null
  // If 'for' is 'finalized', waits until finalized and returns the L1 receipt, or null if not found
  // pollMs is the polling interval (default: 5500ms, minimum: 1000ms)
  // timeoutMs is the maximum time to wait (default: no timeout)
  wait(
    h: WithdrawalWaitable | Hex,
    opts: { for: 'l2' | 'ready' | 'finalized'; pollMs?: number; timeoutMs?: number },
  ): Promise<TransactionReceiptZKsyncOS | TransactionReceipt | null>;

  // Try to wait for a withdraw to be completed
  tryWait(
    h: WithdrawalWaitable | Hex,
    opts: { for: 'l2' | 'ready' | 'finalized'; pollMs?: number; timeoutMs?: number },
  ): Promise<
    | { ok: true; value: TransactionReceiptZKsyncOS | TransactionReceipt }
    | { ok: false; error: unknown }
  >;

  // Finalize a withdrawal operation on L1 (if not already finalized)
  // Returns the updated status and, if we sent the finalization tx, the L1 receipt
  // May throw if the withdrawal is not yet ready to finalize or if the finalization tx fails
  finalize(l2TxHash: Hex): Promise<{ status: WithdrawalStatus; receipt?: TransactionReceipt }>;

  // Try to finalize a withdrawal operation on L1
  tryFinalize(
    l2TxHash: Hex,
  ): Promise<
    | { ok: true; value: { status: WithdrawalStatus; receipt?: TransactionReceipt } }
    | { ok: false; error: unknown }
  >;
}

export function createWithdrawalsResource(
  client: EthersClient,
  tokens?: TokensResource,
  contracts?: ContractsResource,
): WithdrawalsResource {
  const bundleSvc: WithdrawalBundleFinalizationServices =
    createWithdrawalBundleFinalizationServices(client);
  // error handling
  const { wrap, toResult } = createErrorHandlers('withdrawals');
  // tokens resource (shared)
  const tokensResource = tokens ?? createTokensResource(client);
  const contractsResource = contracts ?? createContractsResource(client);

  // Build a withdrawal plan (route + steps) without executing it
  async function buildPlan(p: WithdrawParams): Promise<WithdrawPlan<TransactionRequest>> {
    const ctx = await commonCtx(p, client, tokensResource, contractsResource);
    await ROUTES[ctx.route].preflight?.(p, ctx);
    const { steps, approvals, fees } = await ROUTES[ctx.route].build(p, ctx);

    return {
      route: ctx.route,
      summary: {
        route: ctx.route,
        approvalsNeeded: approvals,
        amounts: {
          transfer: { token: p.token, amount: p.amount },
        },
        fees,
      },
      steps,
    };
  }
  const finalizeCache = new Map<Hex, Hex>();

  // quote prepares a withdrawal and returns its summary without executing it
  const quote = (p: WithdrawParams): Promise<WithdrawQuote> =>
    wrap(
      OP_WITHDRAWALS.quote,
      async () => {
        const plan = await buildPlan(p);
        return plan.summary;
      },
      {
        message: 'Internal error while preparing a withdrawal quote.',
        ctx: { token: p.token, where: 'withdrawals.quote' },
      },
    );

  // tryQuote attempts to prepare a withdrawal and returns its summary without executing it
  const tryQuote = (p: WithdrawParams) =>
    toResult(
      OP_WITHDRAWALS.tryQuote,
      async () => {
        const plan = await buildPlan(p);
        return plan.summary;
      },
      {
        message: 'Internal error while preparing a withdrawal quote.',
        ctx: { token: p.token, where: 'withdrawals.tryQuote' },
      },
    );

  // prepare prepares a withdrawal plan without executing it
  const prepare = (p: WithdrawParams): Promise<WithdrawPlan<TransactionRequest>> =>
    wrap(OP_WITHDRAWALS.prepare, () => buildPlan(p), {
      message: 'Internal error while preparing a withdrawal plan.',
      ctx: { token: p.token, where: 'withdrawals.prepare' },
    });

  // tryPrepare attempts to prepare a withdrawal plan without executing it
  const tryPrepare = (p: WithdrawParams) =>
    toResult(OP_WITHDRAWALS.tryPrepare, () => buildPlan(p), {
      message: 'Internal error while preparing a withdrawal plan.',
      ctx: { token: p.token, where: 'withdrawals.tryPrepare' },
    });

  // create prepares and executes a withdrawal plan
  const create = (p: WithdrawParams): Promise<WithdrawHandle<TransactionRequest>> =>
    wrap(
      OP_WITHDRAWALS.create,
      async () => {
        const plan = await prepare(p);
        const execution = await executeSourcePlan({
          steps: plan.steps,
          nonce: p.l2TxOverrides?.nonce,
          driver: createEthersTransactionDriver({
            provider: client.l2,
            signer: client.getL2Signer(),
            defaultNonceTag: 'pending',
            overrides: p.l2TxOverrides,
            synchronizePendingNonce: true,
            gasPolicy: {
              mode: 'when-missing',
              resolveGasLimit: ({ estimatedGasLimit }) => (estimatedGasLimit * 115n) / 100n,
            },
            revertedError: ({ step, txHash, nonce }) =>
              createError('EXECUTION', {
                resource: 'withdrawals',
                operation: 'withdrawals.create.sendTransaction',
                message: 'Withdrawal transaction reverted on L2 during a step.',
                context: { step: step.key, txHash, nonce },
              }),
            mapError: (error, { step, txHash, nonce }) =>
              toZKsyncError(
                'EXECUTION',
                {
                  resource: 'withdrawals',
                  operation: 'withdrawals.create.sendTransaction',
                  message: 'Failed to send or confirm a withdrawal transaction step.',
                  context: { step: step.key, txHash, nonce },
                },
                error,
              ),
          }),
        });

        const l2TxHash = execution.lastSourceHash ?? ('0x' as Hex);
        return { kind: 'withdrawal', l2TxHash, stepHashes: execution.stepHashes, plan };
      },
      {
        message: 'Internal error while creating withdrawal transactions.',
        ctx: { token: p.token, amount: p.amount, to: p.to, where: 'withdrawals.create' },
      },
    );

  // tryCreate attempts to prepare and execute a withdrawal plan
  const tryCreate = (p: WithdrawParams) =>
    toResult(OP_WITHDRAWALS.tryCreate, () => create(p), {
      message: 'Internal error while creating withdrawal transactions.',
      ctx: { token: p.token, amount: p.amount, to: p.to, where: 'withdrawals.tryCreate' },
    });

  // Returns the status of a withdrawal operation
  const status = (h: WithdrawalWaitable | Hex): Promise<WithdrawalStatus> =>
    wrap(
      OP_WITHDRAWALS.status,
      async () => {
        const l2TxHash: Hex =
          typeof h === 'string' ? h : 'l2TxHash' in h && h.l2TxHash ? h.l2TxHash : ('0x' as Hex);

        if (!l2TxHash || l2TxHash === ('0x' as Hex)) {
          return { phase: 'UNKNOWN', l2TxHash: '0x' as Hex };
        }

        const providedL1TxHash = typeof h !== 'string' && 'l1TxHash' in h ? h.l1TxHash : undefined;
        return inspectWithdrawalBundleLifecycle({
          l2TxHash,
          isSourceIncluded: async () => {
            try {
              return Boolean(await client.l2.getTransactionReceipt(l2TxHash));
            } catch (e) {
              if (isReceiptNotFound(e)) return false;
              throw toZKsyncError(
                'RPC',
                {
                  resource: 'withdrawals',
                  operation: 'withdrawals.status.getTransactionReceipt',
                  message: 'Failed to fetch L2 transaction receipt.',
                  context: { l2TxHash, where: 'l2.getTransactionReceipt' },
                },
                e,
              );
            }
          },
          getFinalizationInfo: () => bundleSvc.fetchBundleFinalizationInfo(l2TxHash),
          readBundleState: (bundleHash) => bundleSvc.readBundleState(bundleHash),
          simulate: (info) => bundleSvc.simulateExecuteBundle(info),
          getExecutionState: async () => {
            const txHash = providedL1TxHash ?? finalizeCache.get(l2TxHash);
            if (!txHash) return undefined;
            try {
              const receipt = await client.l1.getTransactionReceipt(txHash);
              if (!receipt) return { txHash, state: 'pending' };
              return { txHash, state: receipt.status === 0 ? 'failed' : 'success' };
            } catch {
              return { txHash, state: 'pending' };
            }
          },
        });
      },
      {
        message: 'Internal error while checking withdrawal status.',
        ctx: { where: 'withdrawals.status', l2TxHash: typeof h === 'string' ? h : h.l2TxHash },
      },
    );

  // wait until the withdrawal reaches the desired state
  // If the handle has no L2 tx hash, returns null immediately
  // If 'for' is 'l2', waits for L2 inclusion and returns the L2 receipt
  // If 'for' is 'ready', waits until finalization is possible (no side-effects) and returns null
  // If 'for' is 'finalized', waits until finalized and returns the L1 receipt, or null if not found
  // pollMs is the polling interval (default: 5500ms, minimum: 1000ms)
  // timeoutMs is the maximum time to wait (default: no timeout)
  const wait = (
    h: WithdrawalWaitable | Hex,
    opts: { for: 'l2' | 'ready' | 'finalized'; pollMs?: number; timeoutMs?: number } = {
      for: 'l2',
      pollMs: 5500,
    },
  ): Promise<TransactionReceiptZKsyncOS | TransactionReceipt | null> =>
    wrap(
      OP_WITHDRAWALS.wait,
      async () => {
        const l2Hash: Hex =
          typeof h === 'string' ? h : 'l2TxHash' in h && h.l2TxHash ? h.l2TxHash : ('0x' as Hex);

        if (!l2Hash || l2Hash === ('0x' as Hex)) return null;

        // wait for L2 inclusion
        if (opts.for === 'l2') {
          let rcpt: TransactionReceiptZKsyncOS | null;
          try {
            rcpt = await client.l2.waitForTransaction(l2Hash);
          } catch (e) {
            throw toZKsyncError(
              'RPC',
              {
                resource: 'withdrawals',
                operation: 'withdrawals.wait.l2.waitForTransaction',
                message: 'Failed while waiting for L2 transaction.',
                context: { l2TxHash: l2Hash },
              },
              e,
            );
          }
          if (!rcpt) return null;

          try {
            const raw = (await client.zks.getReceiptWithL2ToL1(l2Hash)) as ReceiptWithL2ToL1;
            rcpt.l2ToL1Logs = raw?.l2ToL1Logs ?? [];
          } catch {
            rcpt.l2ToL1Logs = rcpt.l2ToL1Logs ?? [];
          }
          return rcpt;
        }

        const poll = Math.max(1000, opts.pollMs ?? 2500);
        const completed = await pollWithdrawalStatus({
          read: () => status(l2Hash),
          done: (current) =>
            opts.for === 'ready'
              ? current.phase === 'READY_TO_FINALIZE' || current.phase === 'FINALIZED'
              : current.phase === 'FINALIZED',
          pollMs: poll,
          timeoutMs: opts.timeoutMs,
        });
        if (!completed || opts.for === 'ready') return null;

        const l1Hash = completed.l1FinalizeTxHash ?? finalizeCache.get(l2Hash);
        if (!l1Hash) return null;
        try {
          const l1Rcpt = await client.l1.getTransactionReceipt(l1Hash);
          if (l1Rcpt) {
            finalizeCache.delete(l2Hash);
            return l1Rcpt;
          }
        } catch {
          // Finalized status is authoritative even when receipt lookup is unavailable.
        }
        return null;
      },
      {
        message: 'Internal error while waiting for withdrawal.',
        ctx: {
          where: 'withdrawals.wait',
          l2TxHash: typeof h === 'string' ? h : h.l2TxHash,
          for: opts.for,
        },
      },
    );

  // Finalize a withdrawal operation on L1 (if not already finalized)
  const finalize = (
    l2TxHash: Hex,
  ): Promise<{ status: WithdrawalStatus; receipt?: TransactionReceipt }> =>
    wrap(
      OP_WITHDRAWALS.finalize.send,
      async () => {
        const result = await finalizeWithdrawalBundleLifecycle({
          getFinalizationInfo: async () => {
            try {
              return await bundleSvc.fetchBundleFinalizationInfo(l2TxHash);
            } catch (e) {
              throw createError('STATE', {
                resource: 'withdrawals',
                operation: OP_WITHDRAWALS.finalize.fetchParams.receipt,
                message: 'Withdrawal not ready: bundle proof unavailable.',
                context: { l2TxHash },
                cause: e,
              });
            }
          },
          readBundleState: (bundleHash) => bundleSvc.readBundleState(bundleHash),
          simulate: (info) => bundleSvc.simulateExecuteBundle(info),
          execute: async (info) => {
            const tx = await bundleSvc.executeBundle(info);
            finalizeCache.set(l2TxHash, tx.hash);
            return tx;
          },
        });

        if (!result.execution) return { status: await status(l2TxHash) };
        const { info, execution } = result;
        return {
          status: {
            phase: 'FINALIZED',
            l2TxHash,
            l1FinalizeTxHash: execution.hash,
            key: {
              bundleHash: info.bundleHash,
              chainIdL2: info.proof.chainId,
              l2BatchNumber: info.proof.l1BatchNumber,
              l2MessageIndex: info.proof.l2MessageIndex,
            },
          },
          receipt: execution.receipt,
        };
      },
      {
        message: 'Internal error while attempting to finalize withdrawal.',
        ctx: { l2TxHash, where: 'withdrawals.finalize' },
      },
    );

  // tryFinalize attempts to finalize a withdrawal operation on L1
  const tryFinalize = (l2TxHash: Hex) =>
    toResult('withdrawals.tryFinalize', () => finalize(l2TxHash), {
      message: 'Internal error while attempting to tryFinalize withdrawal.',
      ctx: { l2TxHash, where: 'withdrawals.tryFinalize' },
    });

  // tryWait is like wait, but returns a TryResult instead of throwing
  const tryWait = (
    h: WithdrawalWaitable | Hex,
    opts: { for: 'l2' | 'ready' | 'finalized'; pollMs?: number; timeoutMs?: number },
  ) =>
    toResult<TransactionReceiptZKsyncOS | TransactionReceipt>(
      OP_WITHDRAWALS.tryWait,
      async () => {
        const v = await wait(h, opts);
        if (v) return v;
        throw createError('STATE', {
          resource: 'withdrawals',
          operation: 'withdrawals.tryWait',
          message:
            opts.for === 'l2'
              ? 'No L2 receipt yet; the withdrawal has not executed on L2.'
              : 'No L1 receipt yet; the withdrawal has not been included on L1.',
          context: {
            for: opts.for,
            l2TxHash: typeof h === 'string' ? h : 'l2TxHash' in h ? (h.l2TxHash as Hex) : undefined,
            where: 'withdrawals.tryWait',
          },
        });
      },
      {
        message: 'Internal error while waiting for withdrawal.',
        ctx: { input: h, for: opts?.for, where: 'withdrawals.tryWait' },
      },
    );

  return {
    quote,
    tryQuote,
    prepare,
    tryPrepare,
    create,
    tryCreate,
    status,
    wait,
    finalize,
    tryFinalize,
    tryWait,
  };
}

export { createFinalizationServices };
export type { FinalizationServices };
