// src/adapters/viem/resources/withdrawals/index.ts
import type { ViemClient } from '../../client';
import type {
  WithdrawParams,
  WithdrawQuote,
  WithdrawPlan,
  WithdrawHandle,
  WithdrawalWaitable,
  WithdrawRoute,
  WithdrawalStatus,
  FinalizeDepositParams,
} from '../../../../core/types/flows/withdrawals';
import type { Address, Hex } from '../../../../core/types/primitives';
import type {
  Abi,
  EstimateContractGasParameters,
  TransactionReceipt,
  WriteContractParameters,
} from 'viem';

import { commonCtx } from './context';
import { toZKsyncError, createErrorHandlers } from '../../errors/error-ops';
import { createError } from '../../../../core/errors/factory';
import { isReceiptNotFound } from '../../../../core/types/errors';
import type {
  WithdrawRouteStrategy,
  TransactionReceiptZKsyncOS,
  ViemPlanWriteRequest,
} from './routes/types';
import { routeEthBase } from './routes/eth';
import { routeErc20NonBase } from './routes/erc20-nonbase';
import { createFinalizationServices, type FinalizationServices } from './services/finalization';
import { OP_WITHDRAWALS } from '../../../../core/types/errors';
import type { ReceiptWithL2ToL1 } from '../../../../core/rpc/types';
import { createTokensResource } from '../tokens';
import type { TokensResource } from '../../../../core/types/flows/token';
import { createContractsResource } from '../contracts';
import type { ContractsResource } from '../contracts';

// --------------------
// Withdrawal Route map
// --------------------
export const ROUTES: Record<WithdrawRoute, WithdrawRouteStrategy> = {
  base: routeEthBase(), // BaseTokenSystem.withdraw, chain base = ETH
  'erc20-nonbase': routeErc20NonBase(), // AssetRouter.withdraw for non-base ERC-20s
};

export interface WithdrawalsResource {
  // Get a quote for a withdrawal operation
  quote(p: WithdrawParams): Promise<WithdrawQuote>;

  // Try to get a quote for a withdrawal operation
  tryQuote(
    p: WithdrawParams,
  ): Promise<{ ok: true; value: WithdrawQuote } | { ok: false; error: unknown }>;

  // Prepare a withdrawal plan (route + steps) without executing it
  prepare(p: WithdrawParams): Promise<WithdrawPlan<ViemPlanWriteRequest>>;

  // Try to prepare a withdrawal plan without executing it
  tryPrepare(
    p: WithdrawParams,
  ): Promise<
    { ok: true; value: WithdrawPlan<ViemPlanWriteRequest> } | { ok: false; error: unknown }
  >;

  // Execute a withdrawal operation
  // Returns a handle that can be used to track the status of the withdrawal
  create(p: WithdrawParams): Promise<WithdrawHandle<ViemPlanWriteRequest>>;

  // Try to execute a withdrawal operation
  tryCreate(
    p: WithdrawParams,
  ): Promise<
    { ok: true; value: WithdrawHandle<ViemPlanWriteRequest> } | { ok: false; error: unknown }
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
  client: ViemClient,
  tokens?: TokensResource,
  contracts?: ContractsResource,
): WithdrawalsResource {
  // Finalization services
  const svc: FinalizationServices = createFinalizationServices(client);
  // error handlers
  const { wrap, toResult } = createErrorHandlers('withdrawals');
  const tokensResource = tokens ?? createTokensResource(client);
  const contractsResource = contracts ?? createContractsResource(client);

  // Build a withdrawal plan (route + steps) without executing it
  async function buildPlan(p: WithdrawParams): Promise<WithdrawPlan<ViemPlanWriteRequest>> {
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

  const finalizeCache = new Map<Hex, string>();

  // quote prepares a withdrawal and returns its summary without executing it
  const quote = (p: WithdrawParams): Promise<WithdrawQuote> =>
    wrap(OP_WITHDRAWALS.quote, async () => (await buildPlan(p)).summary, {
      message: 'Internal error while preparing a withdrawal quote.',
      ctx: { token: p.token, where: 'withdrawals.quote' },
    });

  // tryQuote attempts to prepare a withdrawal and returns its summary without executing it
  const tryQuote = (p: WithdrawParams) =>
    toResult(OP_WITHDRAWALS.tryQuote, () => quote(p), {
      message: 'Internal error while preparing a withdrawal quote.',
      ctx: { token: p.token, where: 'withdrawals.tryQuote' },
    });

  // prepare prepares a withdrawal plan without executing it
  const prepare = (p: WithdrawParams): Promise<WithdrawPlan<ViemPlanWriteRequest>> =>
    wrap(OP_WITHDRAWALS.prepare, () => buildPlan(p), {
      message: 'Internal error while preparing a withdrawal plan.',
      ctx: { token: p.token, where: 'withdrawals.prepare' },
    });

  // tryPrepare attempts to prepare a withdrawal plan without executing it
  const tryPrepare = (p: WithdrawParams) =>
    toResult(OP_WITHDRAWALS.tryPrepare, () => prepare(p), {
      message: 'Internal error while preparing a withdrawal plan.',
      ctx: { token: p.token, where: 'withdrawals.tryPrepare' },
    });

  // create prepares and executes a withdrawal plan
  const create = (p: WithdrawParams): Promise<WithdrawHandle<ViemPlanWriteRequest>> =>
    wrap(
      OP_WITHDRAWALS.create,
      async () => {
        const plan = await prepare(p);
        const stepHashes: Record<string, Hex> = {};

        const l2Wallet = client.getL2Wallet();

        for (const step of plan.steps) {
          if (p.l2TxOverrides) {
            const overrides = p.l2TxOverrides;
            if (overrides.maxFeePerGas != null) step.tx.maxFeePerGas = overrides.maxFeePerGas;
            if (overrides.maxPriorityFeePerGas != null) {
              step.tx.maxPriorityFeePerGas = overrides.maxPriorityFeePerGas;
            }
            if (overrides.gasLimit != null) step.tx.gas = overrides.gasLimit;
          }

          // If no explicit gas limit override, try to re-estimate
          // This ensures we use the Public Client for estimation (which handles accounts correctly)
          // rather than relying on WalletClient which seems to have issues with account context in some versions.
          if (!p.l2TxOverrides?.gasLimit) {
            try {
              const feePart =
                step.tx.maxFeePerGas != null && step.tx.maxPriorityFeePerGas != null
                  ? {
                      maxFeePerGas: step.tx.maxFeePerGas,
                      maxPriorityFeePerGas: step.tx.maxPriorityFeePerGas,
                    }
                  : {};
              const params: EstimateContractGasParameters = {
                address: step.tx.address,
                abi: step.tx.abi as Abi,
                functionName: step.tx.functionName,
                args: step.tx.args ?? [],
                account: step.tx.account ?? l2Wallet.account ?? client.account,
                ...(step.tx.value != null ? { value: step.tx.value } : {}),
                ...feePart,
              };
              const gas = await client.l2.estimateContractGas(params);
              step.tx.gas = (gas * 115n) / 100n;
            } catch {
              // If re-estimation fails, keep the original gasLimit
            }
          }
          // TODO: revisit fees
          const fee1559 =
            step.tx.maxFeePerGas != null && step.tx.maxPriorityFeePerGas != null
              ? {
                  maxFeePerGas: step.tx.maxFeePerGas,
                  maxPriorityFeePerGas: step.tx.maxPriorityFeePerGas,
                }
              : {};

          const baseReq = {
            address: step.tx.address,
            abi: step.tx.abi as Abi,
            functionName: step.tx.functionName,
            args: step.tx.args ?? [],
            account: step.tx.account ?? l2Wallet.account ?? client.account,
            gas: step.tx.gas,
            ...fee1559,
            ...(step.tx.dataSuffix ? { dataSuffix: step.tx.dataSuffix } : {}),
            ...(step.tx.chain ? { chain: step.tx.chain } : {}),
          } as Omit<WriteContractParameters, 'value'>;

          // viem hack
          const execReq: WriteContractParameters =
            step.tx.value != null
              ? ({ ...baseReq, value: step.tx.value } as WriteContractParameters)
              : (baseReq as WriteContractParameters);

          let hash: Hex | undefined;
          try {
            if (!client.l2Wallet) {
              throw createError('EXECUTION', {
                resource: 'withdrawals',
                operation: 'withdrawals.create.getL2Wallet',
                message: 'No L2 wallet available to send withdrawal transaction step.',
                context: { step: step.key, l2Wallet: l2Wallet },
              });
            }
            hash = await l2Wallet.writeContract(execReq);
            stepHashes[step.key] = hash;

            const rcpt = await client.l2.waitForTransactionReceipt({ hash });
            if (!rcpt || rcpt.status !== 'success') {
              throw createError('EXECUTION', {
                resource: 'withdrawals',
                operation: 'withdrawals.create.writeContract',
                message: 'Withdrawal transaction reverted on L2 during a step.',
                context: { step: step.key, txHash: hash, status: rcpt?.status },
              });
            }
          } catch (e) {
            throw toZKsyncError(
              'EXECUTION',
              {
                resource: 'withdrawals',
                operation: 'withdrawals.create.writeContract',
                message: 'Failed to send or confirm a withdrawal transaction step.',
                context: { step: step.key, txHash: hash, l2Wallet: l2Wallet },
              },
              e,
            );
          }
        }

        const keys = Object.keys(stepHashes);
        const l2TxHash = stepHashes[keys[keys.length - 1]];
        return { kind: 'withdrawal', l2TxHash, stepHashes, plan };
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

        // L2 receipt
        let l2Rcpt: TransactionReceipt | null;
        try {
          l2Rcpt = await client.l2.getTransactionReceipt({ hash: l2TxHash });
        } catch (e) {
          if (isReceiptNotFound(e)) {
            // Expected pending state: do not throw
            return { phase: 'L2_PENDING', l2TxHash };
          }
          // Unexpected provider/transport error: do throw
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
        if (!l2Rcpt) return { phase: 'L2_PENDING', l2TxHash };

        // Derive finalize params/key — if unavailable, not ready yet
        let pack: { params: FinalizeDepositParams; nullifier: Address } | undefined;
        try {
          pack = await svc.fetchFinalizeDepositParams(l2TxHash);
        } catch {
          return { phase: 'PENDING', l2TxHash };
        }

        const key = {
          chainId: pack.params.chainId,
          l2BatchNumber: pack.params.l2BatchNumber,
          l2MessageIndex: pack.params.l2MessageIndex,
        };

        try {
          const done = await svc.isWithdrawalFinalized(key);
          if (done) return { phase: 'FINALIZED', l2TxHash, key };
        } catch {
          // ignore; continue to readiness simulation
        }

        // check finalization would succeed right now
        const readiness = await svc.simulateFinalizeReadiness(pack.params);
        if (readiness.kind === 'FINALIZED') return { phase: 'FINALIZED', l2TxHash, key };
        if (readiness.kind === 'READY') return { phase: 'READY_TO_FINALIZE', l2TxHash, key };

        return { phase: 'PENDING', l2TxHash, key };
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

        if (opts.for === 'l2') {
          let rcpt: TransactionReceipt | null;
          try {
            rcpt = await client.l2.waitForTransactionReceipt({ hash: l2Hash });
          } catch (e) {
            throw toZKsyncError(
              'RPC',
              {
                resource: 'withdrawals',
                operation: 'withdrawals.wait.l2.waitForTransactionReceipt',
                message: 'Failed while waiting for L2 transaction.',
                context: { l2TxHash: l2Hash },
              },
              e,
            );
          }
          if (!rcpt) return null;

          // Attach L2→L1 logs
          try {
            const raw = (await client.zks.getReceiptWithL2ToL1(l2Hash)) as ReceiptWithL2ToL1;
            const zkRcpt: TransactionReceiptZKsyncOS = {
              ...rcpt,
              l2ToL1Logs: raw?.l2ToL1Logs ?? [],
            };
            return zkRcpt;
          } catch {
            const zkRcpt: TransactionReceiptZKsyncOS = { ...rcpt, l2ToL1Logs: [] };
            return zkRcpt;
          }
        }

        const poll = Math.max(1000, opts.pollMs ?? 2500);
        const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : undefined;

        while (true) {
          const s = await status(l2Hash);

          if (opts.for === 'ready') {
            if (s.phase === 'READY_TO_FINALIZE' || s.phase === 'FINALIZED') return null;
          } else {
            if (s.phase === 'FINALIZED') {
              const l1Hash = finalizeCache.get(l2Hash) as Hex;
              if (l1Hash) {
                try {
                  const l1Rcpt = await client.l1.getTransactionReceipt({ hash: l1Hash });
                  if (l1Rcpt) {
                    finalizeCache.delete(l2Hash);
                    return l1Rcpt;
                  }
                } catch {
                  /* ignore */
                }
              }
              return null;
            }
          }

          if (deadline && Date.now() > deadline) return null;
          await new Promise((r) => setTimeout(r, poll));
        }
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
        const pack = await (async () => {
          try {
            return await svc.fetchFinalizeDepositParams(l2TxHash);
          } catch (e: unknown) {
            throw createError('STATE', {
              resource: 'withdrawals',
              operation: OP_WITHDRAWALS.finalize.fetchParams.receipt,
              message: 'Withdrawal not ready: finalize params unavailable.',
              context: { l2TxHash },
              cause: e,
            });
          }
        })();

        const { params } = pack;
        const key = {
          chainId: params.chainId,
          l2BatchNumber: params.l2BatchNumber,
          l2MessageIndex: params.l2MessageIndex,
        };

        try {
          const done = await svc.isWithdrawalFinalized(key);
          if (done) {
            const statusNow = await status(l2TxHash);
            return { status: statusNow };
          }
        } catch {
          // ignore; continue to readiness simulation
        }

        const readiness = await svc.simulateFinalizeReadiness(params);
        if (readiness.kind === 'FINALIZED') {
          const statusNow = await status(l2TxHash);
          return { status: statusNow };
        }
        if (readiness.kind === 'NOT_READY') {
          throw createError('STATE', {
            resource: 'withdrawals',
            operation: OP_WITHDRAWALS.finalize.readiness.simulate,
            message: 'Withdrawal not ready to finalize.',
            context: readiness,
          });
        }

        // READY → send finalize tx on L1
        try {
          const tx = await svc.finalizeDeposit(params);
          finalizeCache.set(l2TxHash, tx.hash);
          const rcpt = await tx.wait();
          const statusNow = await status(l2TxHash);
          return { status: statusNow, receipt: rcpt };
        } catch (e) {
          const statusNow = await status(l2TxHash);
          if (statusNow.phase === 'FINALIZED') return { status: statusNow };

          try {
            const again = await svc.simulateFinalizeReadiness(params);
            if (again.kind === 'NOT_READY') {
              throw createError('STATE', {
                resource: 'withdrawals',
                operation: OP_WITHDRAWALS.finalize.readiness.simulate,
                message: 'Withdrawal not ready to finalize.',
                context: again,
              });
            }
          } catch {
            // ignore; rethrow EXECUTION error below
          }
          throw e;
        }
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
  };
}

export { createFinalizationServices };
export type { FinalizationServices };
