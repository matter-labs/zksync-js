// src/adapters/ethers/resources/interop/index.ts
import type { EthersClient } from '../../client';
import type { Hex } from '../../../../core/types/primitives';
import { createEthersAttributesResource } from './attributes';
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
import { commonCtx } from './context';
import { createError } from '../../../../core/errors/factory';
import { pickInteropRoute } from '../../../../core/resources/interop/route';
import {
  status as interopStatus,
  wait as interopWait,
  createInteropFinalizationServices,
} from './services/finalization';

const { wrap, toResult } = createErrorHandlers('interop');

// --------------------
// Interop Route map
// --------------------
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
    opts?: { for?: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;

  tryWait(
    h: InteropWaitable,
    opts?: { for?: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
  ): Promise<{ ok: true; value: InteropFinalizationInfo } | { ok: false; error: unknown }>;

  finalize(h: InteropWaitable | InteropFinalizationInfo): Promise<InteropFinalizationResult>;
  tryFinalize(
    h: InteropWaitable,
  ): Promise<{ ok: true; value: InteropFinalizationResult } | { ok: false; error: unknown }>;
}

export function createInteropResource(
  client: EthersClient,
  tokens?: TokensResource,
  contracts?: ContractsResource,
  attributes?: AttributesResource,
): InteropResource {
  const tokensResource = tokens ?? createTokensResource(client);
  const contractsResource = contracts ?? createContractsResource(client);
  const attributesResource = attributes ?? createEthersAttributesResource();

  // Internal helper: buildPlan constructs an InteropPlan for the given params.
  // It does not execute any transactions.
  async function buildPlan(params: InteropParams): Promise<InteropPlan<TransactionRequest>> {
    // 1) Build adapter context (providers, signer, addresses, ABIs, topics, base tokens)
    const ctx = await commonCtx(params, client, tokensResource, contractsResource, attributesResource);

    // // 2) Compute sender and select route
    // const sender = (p.sender ?? client.signer) as Address;
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

    // 3) Extend context so indirect route can embed sender into payloads
    //const ctx = { ...ethCtx, route, sender } as const;

    // 4) Route-level preflight
    await wrap(
      route === 'direct'
        ? OP_INTEROP.routes.direct.preflight
        : OP_INTEROP.routes.indirect.preflight,
      () => ROUTES[route].preflight?.(params, ctx),
      {
        message: 'Interop preflight failed.',
        ctx: { where: `routes.${route}.preflight`, dst: params.dst },
      },
    );

    // 5) Build concrete steps, approvals, and quote extras
    const { steps, approvals, quoteExtras } = await wrap(
      route === 'direct' ? OP_INTEROP.routes.direct.build : OP_INTEROP.routes.indirect.build,
      () => ROUTES[route].build(params, ctx),
      {
        message: 'Failed to build interop route plan.',
        ctx: { where: `routes.${route}.build`, dst: params.dst },
      },
    );

    // 6) Assemble plan summary
    const summary: InteropQuote = {
      route,
      approvalsNeeded: approvals,
      totalActionValue: quoteExtras.totalActionValue,
      bridgedTokenTotal: quoteExtras.bridgedTokenTotal,
    };

    return { route, summary, steps };
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
      message: 'Internal error while preparing a deposit plan.',
      ctx: { where: 'interop.prepare', dst: params.dst },
    });

  const tryPrepare = (params: InteropParams) =>
    toResult<InteropPlan<TransactionRequest>>(OP_INTEROP.tryPrepare, () => prepare(params));

  // create → execute the source-chain step(s)
  // waits for each tx receipt to confirm (status != 0)
  const create = (params: InteropParams): Promise<InteropHandle<TransactionRequest>> =>
    wrap(
      OP_INTEROP.create,
      async () => {
        // Build plan (like before)
        const plan = await prepare(params);
        // Build the SAME interop context we used to build that plan
        const ctx = await commonCtx(params, client, tokensResource, contractsResource, attributesResource);
        // source signer MUST be bound to ctx.srcChainId
        const signer = ctx.client.signerFor(ctx.chainId);
        const srcProvider = ctx.client.getProvider(ctx.chainId)!;

        const from = await signer.getAddress();
        let next = await srcProvider.getTransactionCount(from, 'latest');

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
              try {
                await srcProvider.call(step.tx); // 'call' gives better revert data than 'estimateGas'
              } catch (e) {
                console.log("REAL ERROR:", (e as { data?: unknown }).data); // This hex string can be decoded
              }

              const est = await srcProvider.estimateGas(step.tx);
              step.tx.gasLimit = (BigInt(est) * 115n) / 100n;
            } catch {
              // ignore; signer can still populate
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
          dstChainId: params.dst,
        };
      },
      {
        message: 'Internal error while creating interop bundle.',
        ctx: { where: 'interop.create', dst: params.dst },
      },
    );

  const tryCreate = (params: InteropParams) =>
    toResult<InteropHandle<TransactionRequest>>(OP_INTEROP.tryCreate, () => create(params));

  // status → non-blocking lifecycle inspection
  const status = (h: InteropWaitable): Promise<InteropStatus> =>
    wrap(OP_INTEROP.status, () => interopStatus(client, h), {
      message: 'Internal error while checking interop status.',
      ctx: { where: 'interop.status' },
    });

  // wait → block until source finalization + destination root availability
  const wait = (
    h: InteropWaitable,
    opts?: { for?: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo> =>
    wrap(OP_INTEROP.wait, () => interopWait(client, h, opts), {
      message: 'Internal error while waiting for interop finalization.',
      ctx: { where: 'interop.wait', for: opts?.for },
    });

  const tryWait = (
    h: InteropWaitable,
    opts: { for: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
  ) => toResult<InteropFinalizationInfo>(OP_INTEROP.tryWait, () => wait(h, opts));

  // finalize → executeBundle on destination chain,
  // waits until that destination tx is mined,
  // returns finalization metadata for UI / explorers.
  const finalize = (h: InteropWaitable | InteropFinalizationInfo): Promise<InteropFinalizationResult> =>
    wrap(
      OP_INTEROP.finalize,
      async () => {
        const svc = createInteropFinalizationServices(client);

        const info = isInteropFinalizationInfo(h) ? h : await svc.waitForFinalization(h);

        // submit executeBundle on destination
        const execResult = await svc.executeBundle(info);

        // wait for inclusion / revert surfaced as EXECUTION error
        await execResult.wait();

        const dstExecTxHash = execResult.hash;

        return {
          bundleHash: info.bundleHash,
          dstChainId: info.dstChainId,
          dstExecTxHash,
        };
      },
      {
        message: 'Failed to finalize/execute interop bundle on destination.',
        ctx: { where: 'interop.finalize' },
      },
    );

  const tryFinalize = (h: InteropWaitable) =>
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
