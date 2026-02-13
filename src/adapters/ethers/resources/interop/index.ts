// src/adapters/ethers/resources/interop/index.ts
import type { EthersClient } from '../../client';
import type { Hex } from '../../../../core/types/primitives';
import { createEthersAttributesResource } from './attributes/resource';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import type {
  InteropRoute,
  InteropPlan,
  InteropQuote,
  InteropStatus,
  InteropFinalizationResult,
  InteropParams as InteropParamsBase,
  InteropHandle as InteropHandleBase,
  InteropWaitable as InteropWaitableBase,
  InteropFinalizationInfo as InteropFinalizationInfoBase,
} from '../../../../core/types/flows/interop';
import { isInteropFinalizationInfo as isInteropFinalizationInfoBase } from '../../../../core/types/flows/interop';
import type { ContractsResource } from '../contracts';
import { createTokensResource } from '../tokens';
import { createContractsResource } from '../contracts';
import type { TokensResource } from '../../../../core/types/flows/token';
import { routeIndirect } from './routes/indirect';
import { routeDirect } from './routes/direct';
import type { InteropRouteStrategy } from './routes/types';
import type { AbstractProvider, TransactionRequest } from 'ethers';
import { JsonRpcProvider } from 'ethers';
import { isZKsyncError, OP_INTEROP } from '../../../../core/types/errors';
import { createErrorHandlers } from '../../errors/error-ops';
import { commonCtx, type BuildCtx } from './context';
import { createError } from '../../../../core/errors/factory';
import { pickInteropRoute } from '../../../../core/resources/interop/route';
import {
  createInteropFinalizationServices,
  type InteropFinalizationServices,
} from './services/finalization';
import type { LogsQueryOptions } from './services/finalization/data-fetchers';

const { wrap, toResult } = createErrorHandlers('interop');

// Interop Route map
export const ROUTES: Record<InteropRoute, InteropRouteStrategy> = {
  direct: routeDirect(),
  indirect: routeIndirect(),
};

export type DstChain = string | AbstractProvider;

export interface InteropParams extends InteropParamsBase {
  dstChain: DstChain;
}

export interface InteropHandle<Tx> extends InteropHandleBase<Tx> {
  dstChain: DstChain;
}

export interface InteropFinalizationInfo extends InteropFinalizationInfoBase {
  dstChain: DstChain;
}

export type InteropWaitable =
  | InteropHandle<unknown>
  | { dstChain: DstChain; waitable: InteropWaitableBase };

/** Resolve a destination chain input (URL string or provider) into an AbstractProvider. */
function resolveDstProvider(dstChain: DstChain): AbstractProvider {
  return typeof dstChain === 'string' ? new JsonRpcProvider(dstChain) : dstChain;
}

function resolveWaitableInput(waitableInput: InteropWaitable): {
  dstProvider: AbstractProvider;
  waitable: InteropWaitableBase;
} {
  const input = waitableInput as { waitable?: InteropWaitableBase };
  return {
    dstProvider: resolveDstProvider(waitableInput.dstChain),
    waitable: input.waitable ? input.waitable : (waitableInput as InteropHandle<unknown>),
  };
}

export interface InteropResource {
  quote(params: InteropParams): Promise<InteropQuote>;

  tryQuote(
    params: InteropParams,
  ): Promise<{ ok: true; value: InteropQuote } | { ok: false; error: unknown }>;

  prepare(params: InteropParams): Promise<InteropPlan<TransactionRequest>>;

  tryPrepare(
    params: InteropParams,
  ): Promise<{ ok: true; value: InteropPlan<TransactionRequest> } | { ok: false; error: unknown }>;

  create(params: InteropParams): Promise<InteropHandle<TransactionRequest>>;

  tryCreate(
    params: InteropParams,
  ): Promise<
    { ok: true; value: InteropHandle<TransactionRequest> } | { ok: false; error: unknown }
  >;

  status(h: InteropWaitable, opts?: LogsQueryOptions): Promise<InteropStatus>;

  wait(
    h: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;

  tryWait(
    h: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<{ ok: true; value: InteropFinalizationInfo } | { ok: false; error: unknown }>;

  finalize(
    h: InteropWaitable | InteropFinalizationInfo,
    opts?: LogsQueryOptions,
  ): Promise<InteropFinalizationResult>;

  tryFinalize(
    h: InteropWaitable | InteropFinalizationInfo,
    opts?: LogsQueryOptions,
  ): Promise<{ ok: true; value: InteropFinalizationResult } | { ok: false; error: unknown }>;
}

export function createInteropResource(
  client: EthersClient,
  tokens?: TokensResource,
  contracts?: ContractsResource,
  attributes?: AttributesResource,
): InteropResource {
  const svc: InteropFinalizationServices = createInteropFinalizationServices(client);
  const tokensResource = tokens ?? createTokensResource(client);
  const contractsResource = contracts ?? createContractsResource(client);
  const attributesResource = attributes ?? createEthersAttributesResource();

  // Internal helper: builds an InteropPlan along with the context used.
  // Returns both so create() can reuse the context without rebuilding.
  async function buildPlanWithCtx(
    dstProvider: AbstractProvider,
    params: InteropParams,
  ): Promise<{ plan: InteropPlan<TransactionRequest>; ctx: BuildCtx }> {
    const ctx = await commonCtx(
      dstProvider,
      params,
      client,
      tokensResource,
      contractsResource,
      attributesResource,
    );

    const route = pickInteropRoute({
      actions: params.actions,
      ctx: {
        sender: ctx.sender,
        srcChainId: ctx.chainId,
        dstChainId: ctx.dstChainId,
        baseTokenSrc: ctx.baseTokens.src,
        baseTokenDst: ctx.baseTokens.dst,
      },
    });

    // Route-level preflight
    await wrap(OP_INTEROP.routes[route].preflight, () => ROUTES[route].preflight?.(params, ctx), {
      message: 'Interop preflight failed.',
      ctx: { where: `routes.${route}.preflight` },
    });

    // Build concrete steps, approvals, and quote extras
    const { steps, approvals, quoteExtras } = await wrap(
      OP_INTEROP.routes[route].build,
      () => ROUTES[route].build(params, ctx),
      {
        message: 'Failed to build interop route plan.',
        ctx: { where: `routes.${route}.build` },
      },
    );

    // Assemble plan summary
    const summary: InteropQuote = {
      route,
      approvalsNeeded: approvals,
      totalActionValue: quoteExtras.totalActionValue,
      bridgedTokenTotal: quoteExtras.bridgedTokenTotal,
    };

    return { plan: { route, summary, steps }, ctx };
  }

  async function buildPlan(
    dstProvider: AbstractProvider,
    params: InteropParams,
  ): Promise<InteropPlan<TransactionRequest>> {
    const { plan } = await buildPlanWithCtx(dstProvider, params);
    return plan;
  }

  // quote → build and return the summary
  const quote = (params: InteropParams): Promise<InteropQuote> =>
    wrap(OP_INTEROP.quote, async () => {
      const plan = await buildPlan(resolveDstProvider(params.dstChain), params);
      return plan.summary;
    });

  const tryQuote = (params: InteropParams) =>
    toResult<InteropQuote>(OP_INTEROP.tryQuote, () => quote(params));

  // prepare → build plan without executing
  const prepare = (params: InteropParams): Promise<InteropPlan<TransactionRequest>> =>
    wrap(OP_INTEROP.prepare, () => buildPlan(resolveDstProvider(params.dstChain), params), {
      message: 'Internal error while preparing an interop plan.',
      ctx: { where: 'interop.prepare' },
    });

  const tryPrepare = (params: InteropParams) =>
    toResult<InteropPlan<TransactionRequest>>(OP_INTEROP.tryPrepare, () => prepare(params));

  // create → execute the source-chain step(s)
  // waits for each tx receipt to confirm (status != 0)
  const create = (params: InteropParams): Promise<InteropHandle<TransactionRequest>> =>
    wrap(
      OP_INTEROP.create,
      async () => {
        // Build plan and reuse the context
        const { plan, ctx } = await buildPlanWithCtx(resolveDstProvider(params.dstChain), params);
        const signer = ctx.client.signerFor(ctx.client.l2);
        const srcProvider = ctx.client.l2;

        const from = await signer.getAddress();
        let next: number;
        if (typeof params.txOverrides?.nonce === 'number') {
          next = params.txOverrides.nonce;
        } else {
          const blockTag = params.txOverrides?.nonce ?? 'pending';
          next = await srcProvider.getTransactionCount(from, blockTag);
        }

        const stepHashes: Record<string, Hex> = {};

        for (const step of plan.steps) {
          step.tx.nonce = next++;

          // lock in chainId so ethers doesn't guess
          if (!step.tx.chainId) {
            step.tx.chainId = Number(ctx.chainId);
          }

          // best-effort gasLimit with buffer
          if (!step.tx.gasLimit) {
            try {
              const est = await srcProvider.estimateGas({
                ...step.tx,
                from,
              });
              step.tx.gasLimit = (BigInt(est) * 115n) / 100n;
            } catch {
              // Intentionally empty: gas estimation is best-effort
            }
          }

          let hash: Hex | undefined;
          try {
            const sent = await signer.sendTransaction(step.tx);
            hash = sent.hash as Hex;
            stepHashes[step.key] = hash;

            const rcpt = await sent.wait();
            if (rcpt?.status === 0) {
              throw createError('EXECUTION', {
                resource: 'interop',
                operation: 'interop.create.sendTransaction',
                message: 'Interop transaction reverted on source L2.',
                context: { step: step.key, txHash: hash },
              });
            }
          } catch (e) {
            if (isZKsyncError(e)) throw e;
            throw createError('EXECUTION', {
              resource: 'interop',
              operation: 'interop.create.sendTransaction',
              message: 'Failed to send or confirm an interop transaction step.',
              context: {
                step: step.key,
                txHash: hash,
                nonce: Number(step.tx.nonce ?? -1),
              },
              cause: e as Error,
            });
          }
        }

        const last = Object.values(stepHashes).pop();
        return {
          kind: 'interop',
          dstChain: params.dstChain,
          stepHashes,
          plan,
          l2SrcTxHash: last ?? ('0x' as Hex),
        };
      },
      {
        message: 'Internal error while creating interop bundle.',
        ctx: { where: 'interop.create' },
      },
    );

  const tryCreate = (params: InteropParams) =>
    toResult<InteropHandle<TransactionRequest>>(OP_INTEROP.tryCreate, () => create(params));

  // status → non-blocking lifecycle inspection
  const status = (h: InteropWaitable, opts?: LogsQueryOptions): Promise<InteropStatus> => {
    const { dstProvider, waitable } = resolveWaitableInput(h);
    return wrap(OP_INTEROP.status, () => svc.status(dstProvider, waitable, opts), {
      message: 'Internal error while checking interop status.',
      ctx: { where: 'interop.status' },
    });
  };

  // wait → block until source finalization + destination root availability
  const wait = (
    h: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo> => {
    const { dstProvider, waitable } = resolveWaitableInput(h);
    return wrap(
      OP_INTEROP.wait,
      async () => {
        const info = await svc.wait(dstProvider, waitable, opts);
        return { ...info, dstChain: h.dstChain };
      },
      {
        message: 'Internal error while waiting for interop finalization.',
        ctx: { where: 'interop.wait' },
      },
    );
  };

  const tryWait = (h: InteropWaitable, opts?: { pollMs?: number; timeoutMs?: number }) =>
    toResult<InteropFinalizationInfo>(OP_INTEROP.tryWait, () => wait(h, opts));

  // finalize → executeBundle on destination chain,
  // waits until that destination tx is mined,
  // returns finalization metadata for UI / explorers.
  const finalize = (
    h: InteropWaitable | InteropFinalizationInfo,
    opts?: LogsQueryOptions,
  ): Promise<InteropFinalizationResult> =>
    wrap(
      OP_INTEROP.finalize,
      async () => {
        if (isInteropFinalizationInfoBase(h)) {
          if (h.dstChain == null) {
            throw createError('STATE', {
              resource: 'interop',
              operation: OP_INTEROP.finalize,
              message: 'Missing dstChain in interop finalization info.',
              context: { input: h },
            });
          }
          const dstProvider = resolveDstProvider(h.dstChain);
          return svc.finalize(dstProvider, h, opts);
        }

        const { dstProvider, waitable } = resolveWaitableInput(h);
        const info = await svc.wait(dstProvider, waitable);
        return svc.finalize(dstProvider, info, opts);
      },
      {
        message: 'Failed to finalize/execute interop bundle on destination.',
        ctx: { where: 'interop.finalize' },
      },
    );

  const tryFinalize = (h: InteropWaitable | InteropFinalizationInfo, opts?: LogsQueryOptions) =>
    toResult<InteropFinalizationResult>(OP_INTEROP.tryFinalize, () => finalize(h, opts));

  return {
    quote,
    tryQuote,
    prepare,
    tryPrepare,
    create,
    tryCreate,
    status,
    wait,
    tryWait,
    finalize,
    tryFinalize,
  };
}

export { createInteropFinalizationServices };
export type { InteropFinalizationServices };
