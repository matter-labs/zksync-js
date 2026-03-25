// src/adapters/viem/resources/interop/index.ts
import type { PublicClient } from 'viem';
import type { ViemClient } from '../../client';
import type { Hex } from '../../../../core/types/primitives';
import { createViemAttributesResource } from './attributes/resource';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import type {
  InteropRoute,
  InteropPlan,
  InteropQuote,
  InteropStatus,
  InteropFinalizationResult,
  InteropParams,
  InteropHandle,
  InteropWaitable,
  InteropFinalizationInfo,
} from '../../../../core/types/flows/interop';
import { isInteropFinalizationInfo as isInteropFinalizationInfoBase } from '../../../../core/types/flows/interop';
import type { ContractsResource } from '../contracts';
import { createTokensResource } from '../tokens';
import { createContractsResource } from '../contracts';
import type { TokensResource } from '../../../../core/types/flows/token';
import { routeIndirect } from './routes/indirect';
import { routeDirect } from './routes/direct';
import type { InteropRouteStrategy, ViemTransactionRequest } from './routes/types';
import { isZKsyncError, OP_INTEROP } from '../../../../core/types/errors';
import { createErrorHandlers, toZKsyncError } from '../../errors/error-ops';
import { commonCtx, type BuildCtx } from './context';
import { createError } from '../../../../core/errors/factory';
import { pickInteropRoute } from '../../../../core/resources/interop/route';
import {
  createInteropFinalizationServices,
  type InteropFinalizationServices,
} from './services/finalization';
import type { LogsQueryOptions } from './services/finalization/data-fetchers';
import type { ChainRef, InteropConfig } from './types';
import { resolveChainRef } from './resolvers';
import { quoteStepsL2Fee } from './services/gas';

const { wrap, toResult } = createErrorHandlers('interop');

// Interop Route map
export const ROUTES: Record<InteropRoute, InteropRouteStrategy> = {
  direct: routeDirect(),
  indirect: routeIndirect(),
};

export interface InteropResource {
  quote(dstChain: ChainRef, params: InteropParams): Promise<InteropQuote>;

  tryQuote(
    dstChain: ChainRef,
    params: InteropParams,
  ): Promise<{ ok: true; value: InteropQuote } | { ok: false; error: unknown }>;

  prepare(dstChain: ChainRef, params: InteropParams): Promise<InteropPlan<ViemTransactionRequest>>;

  tryPrepare(
    dstChain: ChainRef,
    params: InteropParams,
  ): Promise<
    { ok: true; value: InteropPlan<ViemTransactionRequest> } | { ok: false; error: unknown }
  >;

  create(dstChain: ChainRef, params: InteropParams): Promise<InteropHandle<ViemTransactionRequest>>;

  tryCreate(
    dstChain: ChainRef,
    params: InteropParams,
  ): Promise<
    { ok: true; value: InteropHandle<ViemTransactionRequest> } | { ok: false; error: unknown }
  >;

  status(dstChain: ChainRef, h: InteropWaitable, opts?: LogsQueryOptions): Promise<InteropStatus>;

  wait(
    dstChain: ChainRef,
    h: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;

  tryWait(
    dstChain: ChainRef,
    h: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<{ ok: true; value: InteropFinalizationInfo } | { ok: false; error: unknown }>;

  finalize(
    dstChain: ChainRef,
    h: InteropWaitable | InteropFinalizationInfo,
    opts?: LogsQueryOptions,
  ): Promise<InteropFinalizationResult>;

  tryFinalize(
    dstChain: ChainRef,
    h: InteropWaitable | InteropFinalizationInfo,
    opts?: LogsQueryOptions,
  ): Promise<{ ok: true; value: InteropFinalizationResult } | { ok: false; error: unknown }>;
}

export function createInteropResource(
  client: ViemClient,
  config?: InteropConfig,
  tokens?: TokensResource,
  contracts?: ContractsResource,
  attributes?: AttributesResource,
): InteropResource {
  // Lazy provider resolution — validated on first interop method call.
  let gwProviderCache: PublicClient | undefined;

  function requireConfig(): InteropConfig {
    if (!config)
      throw createError('STATE', {
        resource: 'interop',
        operation: 'interop.init',
        message: 'Interop is not configured. Pass gwChain in createViemSdk options.',
      });
    return config;
  }

  function getGwProvider(): PublicClient {
    if (!gwProviderCache) gwProviderCache = resolveChainRef(requireConfig().gwChain);
    return gwProviderCache;
  }

  const svc: InteropFinalizationServices = createInteropFinalizationServices(client);
  const tokensResource = tokens ?? createTokensResource(client);
  const contractsResource = contracts ?? createContractsResource(client);
  const attributesResource = attributes ?? createViemAttributesResource();

  // Internal helper: builds an InteropPlan along with the context used.
  async function buildPlanWithCtx(
    dstPublicClient: PublicClient,
    params: InteropParams,
  ): Promise<{ plan: InteropPlan<ViemTransactionRequest>; ctx: BuildCtx }> {
    const ctx = await commonCtx(
      dstPublicClient,
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
    const { steps, approvals, quoteExtras, interopFee } = await wrap(
      OP_INTEROP.routes[route].build,
      () => ROUTES[route].build(params, ctx),
      {
        message: 'Failed to build interop route plan.',
        ctx: { where: `routes.${route}.build` },
      },
    );

    // Assemble plan summary
    const l2Fee = await quoteStepsL2Fee(steps, ctx).catch(() => undefined);

    const summary: InteropQuote = {
      route,
      approvalsNeeded: approvals,
      totalActionValue: quoteExtras.totalActionValue,
      bridgedTokenTotal: quoteExtras.bridgedTokenTotal,
      interopFee: interopFee,
      l2Fee,
    };

    return { plan: { route, summary, steps }, ctx };
  }

  async function buildPlan(
    dstPublicClient: PublicClient,
    params: InteropParams,
  ): Promise<InteropPlan<ViemTransactionRequest>> {
    const { plan } = await buildPlanWithCtx(dstPublicClient, params);
    return plan;
  }

  // quote → build and return the summary
  const quote = (dstChain: ChainRef, params: InteropParams): Promise<InteropQuote> =>
    wrap(OP_INTEROP.quote, async () => {
      const plan = await buildPlan(resolveChainRef(dstChain), params);
      return plan.summary;
    });

  const tryQuote = (dstChain: ChainRef, params: InteropParams) =>
    toResult<InteropQuote>(OP_INTEROP.tryQuote, () => quote(dstChain, params));

  // prepare → build plan without executing
  const prepare = (
    dstChain: ChainRef,
    params: InteropParams,
  ): Promise<InteropPlan<ViemTransactionRequest>> =>
    wrap(OP_INTEROP.prepare, () => buildPlan(resolveChainRef(dstChain), params), {
      message: 'Internal error while preparing an interop plan.',
      ctx: { where: 'interop.prepare' },
    });

  const tryPrepare = (dstChain: ChainRef, params: InteropParams) =>
    toResult<InteropPlan<ViemTransactionRequest>>(OP_INTEROP.tryPrepare, () =>
      prepare(dstChain, params),
    );

  // create → execute the source-chain step(s)
  // waits for each tx receipt to confirm (status !== reverted)
  const create = (
    dstChain: ChainRef,
    params: InteropParams,
  ): Promise<InteropHandle<ViemTransactionRequest>> =>
    wrap(
      OP_INTEROP.create,
      async () => {
        const { plan } = await buildPlanWithCtx(resolveChainRef(dstChain), params);
        const l2Wallet = client.getL2Wallet();
        const from = client.account.address;

        let next: number;
        if (typeof params.txOverrides?.nonce === 'number') {
          next = params.txOverrides.nonce;
        } else {
          next = await client.l2.getTransactionCount({ address: from, blockTag: 'pending' });
        }

        const stepHashes: Record<string, Hex> = {};

        for (const step of plan.steps) {
          // Best-effort gasLimit with buffer
          let gasLimit = step.tx.gas;
          if (!gasLimit) {
            try {
              const est = await client.l2.estimateGas({
                account: from,
                to: step.tx.to,
                data: step.tx.data,
                value: step.tx.value,
              });
              gasLimit = (est * 115n) / 100n;
            } catch {
              // Intentionally empty: gas estimation is best-effort
            }
          }

          let hash: Hex | undefined;
          try {
            hash = await l2Wallet.sendTransaction({
              to: step.tx.to,
              data: step.tx.data,
              value: step.tx.value,
              gas: gasLimit,
              nonce: next++,
              account: client.account,
              chain: null,
            });
            stepHashes[step.key] = hash;

            const rcpt = await client.l2.waitForTransactionReceipt({ hash });
            if (rcpt.status === 'reverted') {
              throw createError('EXECUTION', {
                resource: 'interop',
                operation: 'interop.create.sendTransaction',
                message: 'Interop transaction reverted on source L2.',
                context: { step: step.key, txHash: hash },
              });
            }
          } catch (e) {
            if (isZKsyncError(e)) throw e;
            throw toZKsyncError(
              'EXECUTION',
              {
                resource: 'interop',
                operation: 'interop.create.sendTransaction',
                message: 'Failed to send or confirm an interop transaction step.',
                context: {
                  step: step.key,
                  txHash: hash,
                  nonce: next - 1,
                },
              },
              e,
            );
          }
        }

        const last = Object.values(stepHashes).pop();
        return {
          kind: 'interop',
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

  const tryCreate = (dstChain: ChainRef, params: InteropParams) =>
    toResult<InteropHandle<ViemTransactionRequest>>(OP_INTEROP.tryCreate, () =>
      create(dstChain, params),
    );

  // status → non-blocking lifecycle inspection
  const status = (
    dstChain: ChainRef,
    h: InteropWaitable,
    opts?: LogsQueryOptions,
  ): Promise<InteropStatus> =>
    wrap(OP_INTEROP.status, () => svc.status(resolveChainRef(dstChain), h, opts), {
      message: 'Internal error while checking interop status.',
      ctx: { where: 'interop.status' },
    });

  // wait → block until source finalization + destination root availability
  const wait = (
    dstChain: ChainRef,
    h: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo> =>
    wrap(OP_INTEROP.wait, () => svc.wait(resolveChainRef(dstChain), getGwProvider(), h, opts), {
      message: 'Internal error while waiting for interop finalization.',
      ctx: { where: 'interop.wait' },
    });

  const tryWait = (
    dstChain: ChainRef,
    h: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ) => toResult<InteropFinalizationInfo>(OP_INTEROP.tryWait, () => wait(dstChain, h, opts));

  // finalize → executeBundle on destination chain
  const finalize = (
    dstChain: ChainRef,
    h: InteropWaitable | InteropFinalizationInfo,
    opts?: LogsQueryOptions,
  ): Promise<InteropFinalizationResult> =>
    wrap(
      OP_INTEROP.finalize,
      async () => {
        const dstProvider = resolveChainRef(dstChain);
        if (isInteropFinalizationInfoBase(h)) {
          return svc.finalize(dstProvider, h, opts);
        }

        const info = await svc.wait(dstProvider, getGwProvider(), h);
        return svc.finalize(dstProvider, info, opts);
      },
      {
        message: 'Failed to finalize/execute interop bundle on destination.',
        ctx: { where: 'interop.finalize' },
      },
    );

  const tryFinalize = (
    dstChain: ChainRef,
    h: InteropWaitable | InteropFinalizationInfo,
    opts?: LogsQueryOptions,
  ) =>
    toResult<InteropFinalizationResult>(OP_INTEROP.tryFinalize, () => finalize(dstChain, h, opts));

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
