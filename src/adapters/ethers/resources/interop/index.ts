// src/adapters/ethers/resources/interop/index.ts
import type { EthersClient } from '../../client';
import type { Hex } from '../../../../core/types/primitives';
import { createEthersAttributesResource } from './attributes/resource';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import type {
  InteropParams,
  InteropRoute,
  InteropHandle,
  InteropPlan,
  InteropQuote,
  InteropWaitable,
  InteropStatus,
  InteropFinalizationInfo,
  InteropFinalizationResult,
} from '../../../../core/types/flows/interop';
import { isInteropFinalizationInfo } from '../../../../core/types/flows/interop';
import type { ContractsResource } from '../contracts';
import { createTokensResource } from '../tokens';
import { createContractsResource } from '../contracts';
import type { TokensResource } from '../../../../core/types/flows/token';
import { routeIndirect } from './routes/indirect';
import { routeDirect } from './routes/direct';
import type { InteropRouteStrategy } from './routes/types';
import type { TransactionRequest } from 'ethers';
import { isZKsyncError, OP_INTEROP } from '../../../../core/types/errors';
import { createErrorHandlers } from '../../errors/error-ops';
import { commonCtx, type BuildCtx } from './context';
import { createError } from '../../../../core/errors/factory';
import { pickInteropRoute } from '../../../../core/resources/interop/route';
import {
  createInteropFinalizationServices,
  type InteropFinalizationServices,
} from './services/finalization';

const { wrap, toResult } = createErrorHandlers('interop');

// Interop Route map
export const ROUTES: Record<InteropRoute, InteropRouteStrategy> = {
  direct: routeDirect(),
  indirect: routeIndirect(),
};

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

  status(h: InteropWaitable): Promise<InteropStatus>;

  wait(
    h: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;

  tryWait(
    h: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<{ ok: true; value: InteropFinalizationInfo } | { ok: false; error: unknown }>;

  finalize(h: InteropWaitable | InteropFinalizationInfo): Promise<InteropFinalizationResult>;
  tryFinalize(
    h: InteropWaitable | InteropFinalizationInfo,
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
    params: InteropParams,
  ): Promise<{ plan: InteropPlan<TransactionRequest>; ctx: BuildCtx }> {
    const ctx = await commonCtx(
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
      ctx: { where: `routes.${route}.preflight`, dstChainId: params.dstChainId },
    });

    // Build concrete steps, approvals, and quote extras
    const { steps, approvals, quoteExtras } = await wrap(
      OP_INTEROP.routes[route].build,
      () => ROUTES[route].build(params, ctx),
      {
        message: 'Failed to build interop route plan.',
        ctx: { where: `routes.${route}.build`, dstChainId: params.dstChainId },
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

  async function buildPlan(params: InteropParams): Promise<InteropPlan<TransactionRequest>> {
    const { plan } = await buildPlanWithCtx(params);
    return plan;
  }

  // quote → build and return the summary
  const quote = (params: InteropParams): Promise<InteropQuote> =>
    wrap(OP_INTEROP.quote, async () => {
      const plan = await buildPlan(params);
      return plan.summary;
    });

  const tryQuote = (params: InteropParams) =>
    toResult<InteropQuote>(OP_INTEROP.tryQuote, () => quote(params));

  // prepare → build plan without executing
  const prepare = (params: InteropParams): Promise<InteropPlan<TransactionRequest>> =>
    wrap(OP_INTEROP.prepare, () => buildPlan(params), {
      message: 'Internal error while preparing an interop plan.',
      ctx: { where: 'interop.prepare', dstChainId: params.dstChainId },
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
        const { plan, ctx } = await buildPlanWithCtx(params);
        const signer = ctx.client.signerFor(ctx.chainId);
        const srcProvider = ctx.client.getProvider(ctx.chainId)!;

        const from = await signer.getAddress();
        let next = await srcProvider.getTransactionCount(from, 'pending');

        const stepHashes: Record<string, Hex> = {};

        for (const step of plan.steps) {
          // lock in nonce
          step.tx.nonce = step.tx.nonce ?? next++;

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
          stepHashes,
          plan,
          l2SrcTxHash: last ?? ('0x' as Hex),
          dstChainId: params.dstChainId,
        };
      },
      {
        message: 'Internal error while creating interop bundle.',
        ctx: { where: 'interop.create', dstChainId: params.dstChainId },
      },
    );

  const tryCreate = (params: InteropParams) =>
    toResult<InteropHandle<TransactionRequest>>(OP_INTEROP.tryCreate, () => create(params));

  // status → non-blocking lifecycle inspection
  const status = (h: InteropWaitable): Promise<InteropStatus> =>
    wrap(OP_INTEROP.status, () => svc.status(h), {
      message: 'Internal error while checking interop status.',
      ctx: { where: 'interop.status' },
    });

  // wait → block until source finalization + destination root availability
  const wait = (
    h: InteropWaitable,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo> =>
    wrap(OP_INTEROP.wait, () => svc.wait(h, opts), {
      message: 'Internal error while waiting for interop finalization.',
      ctx: { where: 'interop.wait' },
    });

  const tryWait = (h: InteropWaitable, opts?: { pollMs?: number; timeoutMs?: number }) =>
    toResult<InteropFinalizationInfo>(OP_INTEROP.tryWait, () => wait(h, opts));

  // finalize → executeBundle on destination chain,
  // waits until that destination tx is mined,
  // returns finalization metadata for UI / explorers.
  const finalize = (
    h: InteropWaitable | InteropFinalizationInfo,
  ): Promise<InteropFinalizationResult> =>
    wrap(
      OP_INTEROP.finalize,
      async () => {
        const info = isInteropFinalizationInfo(h) ? h : await svc.wait(h);
        return svc.finalize(info);
      },
      {
        message: 'Failed to finalize/execute interop bundle on destination.',
        ctx: { where: 'interop.finalize' },
      },
    );

  const tryFinalize = (h: InteropWaitable | InteropFinalizationInfo,) =>
    toResult<InteropFinalizationResult>(OP_INTEROP.tryFinalize, () => finalize(h));

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
