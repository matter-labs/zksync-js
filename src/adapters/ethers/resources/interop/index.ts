// src/adapters/ethers/resources/interop/index.ts
import type { EthersClient } from '../../client';
import type { Hex } from '../../../../core/types/primitives';
import { createEthersAttributesResource } from './attributes';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import type {
  InteropParams, InteropRoute, InteropHandle, InteropPlan, InteropAction, InteropQuote,
  InteropWaitable, InteropStatus, InteropFinalizationInfo, InteropFinalizationResult
} from '../../../../core/types/flows/interop';
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
import { BuildCtx, commonCtx } from './context';
import { createError } from '../../../../core/errors/factory';
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
  quote(p: InteropParams): Promise<InteropQuote>;

  tryQuote(
    p: InteropParams,
  ): Promise<{ ok: true; value: InteropQuote } | { ok: false; error: unknown }>;

  prepare(p: InteropParams): Promise<InteropPlan<TransactionRequest>>;

  tryPrepare(
    p: InteropParams,
  ): Promise<{ ok: true; value: InteropPlan<TransactionRequest> } | { ok: false; error: unknown }>;

  create(p: InteropParams): Promise<InteropHandle<TransactionRequest>>;

  tryCreate(
    p: InteropParams,
  ): Promise<
    { ok: true; value: InteropHandle<TransactionRequest> } | { ok: false; error: unknown }
  >;

  status(h: InteropWaitable | Hex): Promise<InteropStatus>;

  wait(
    h: InteropWaitable | Hex,
    opts?: { for?: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo>;

  tryWait(
    h: InteropWaitable | Hex,
    opts?: { for?: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
  ): Promise<{ ok: true; value: InteropFinalizationInfo } | { ok: false; error: unknown }>;

  finalize(h: InteropWaitable | Hex): Promise<InteropFinalizationResult>;
  tryFinalize(
    h: InteropWaitable | Hex,
  ): Promise<{ ok: true; value: InteropFinalizationResult } | { ok: false; error: unknown }>;
}

function pickInteropRoute(args: {
  actions: readonly InteropAction[];
  ctx: BuildCtx;
}): InteropRoute {
  const hasErc20 = args.actions.some((a) => a.type === 'sendErc20');
  const baseMatches = args.ctx.baseTokens.src.toLowerCase() === args.ctx.baseTokens.dst.toLowerCase();

  // ERC-20 present → indirect. Base mismatch for value → indirect. Else direct.
  if (hasErc20) return 'indirect';
  if (!baseMatches) return 'indirect';
  return 'direct';
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
  async function buildPlan(p: InteropParams): Promise<InteropPlan<TransactionRequest>> {
    // 1) Build adapter context (providers, signer, addresses, ABIs, topics, base tokens)
    const ctx = await commonCtx(p, client, tokensResource, contractsResource, attributesResource);

    // // 2) Compute sender and select route
    // const sender = (p.sender ?? client.signer) as Address;
    const route = pickInteropRoute({
      actions: p.actions,
      ctx,
    });

    // 3) Extend context so indirect route can embed sender into payloads
    //const ctx = { ...ethCtx, route, sender } as const;

    // 4) Route-level preflight
    await wrap(
      route === 'direct'
        ? OP_INTEROP.routes.direct.preflight
        : OP_INTEROP.routes.indirect.preflight,
      () => ROUTES[route].preflight?.(p, ctx),
      {
        message: 'Interop preflight failed.',
        ctx: { where: `routes.${route}.preflight`, dst: p.dst },
      },
    );

    // 5) Build concrete steps, approvals, and quote extras
    const { steps, approvals, quoteExtras } = await wrap(
      route === 'direct' ? OP_INTEROP.routes.direct.build : OP_INTEROP.routes.indirect.build,
      () => ROUTES[route].build(p, ctx),
      {
        message: 'Failed to build interop route plan.',
        ctx: { where: `routes.${route}.build`, dst: p.dst },
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
  const quote = (p: InteropParams): Promise<InteropQuote> =>
    wrap(OP_INTEROP.quote, async () => {
      const plan = await buildPlan(p);
      return plan.summary;
    });

  const tryQuote = (p: InteropParams) =>
    toResult<InteropQuote>(OP_INTEROP.tryQuote, () => quote(p));

  // prepare → build plan without executing
  const prepare = (p: InteropParams): Promise<InteropPlan<TransactionRequest>> =>
    wrap(OP_INTEROP.prepare, () => buildPlan(p), {
      message: 'Internal error while preparing a deposit plan.',
      ctx: { where: 'interop.prepare', dst: p.dst },
    });

  const tryPrepare = (p: InteropParams) =>
    toResult<InteropPlan<TransactionRequest>>(OP_INTEROP.tryPrepare, () => prepare(p));

  // create → execute the source-chain step(s)
  // waits for each tx receipt to confirm (status != 0)
  const create = (p: InteropParams): Promise<InteropHandle<TransactionRequest>> =>
    wrap(
      OP_INTEROP.create,
      async () => {
        // Build plan (like before)
        const plan = await prepare(p);

        // Build the SAME interop context we used to build that plan
        const ctx = await commonCtx(p, client, tokensResource, contractsResource, attributesResource);
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
                console.log("REAL ERROR:", (e as any).data); // This hex string can be decoded
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
          dstChainId: p.dst,
        };
      },
      {
        message: 'Internal error while creating interop bundle.',
        ctx: { where: 'interop.create', dst: p.dst },
      },
    );

  const tryCreate = (p: InteropParams) =>
    toResult<InteropHandle<TransactionRequest>>(OP_INTEROP.tryCreate, () => create(p));

  // status → non-blocking lifecycle inspection
  const status = (h: InteropWaitable | Hex): Promise<InteropStatus> =>
    wrap(OP_INTEROP.status, () => interopStatus(client, h), {
      message: 'Internal error while checking interop status.',
      ctx: { where: 'interop.status' },
    });

  // wait → block until source finalization + destination root availability
  const wait = (
    h: InteropWaitable | Hex,
    opts?: { for?: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
  ): Promise<InteropFinalizationInfo> =>
    wrap(OP_INTEROP.wait, () => interopWait(client, h, opts), {
      message: 'Internal error while waiting for interop finalization.',
      ctx: { where: 'interop.wait', for: opts?.for },
    });

  const tryWait = (
    h: InteropWaitable | Hex,
    opts: { for: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
  ) => toResult<InteropFinalizationInfo>(OP_INTEROP.tryWait, () => wait(h, opts));

  // finalize → executeBundle on destination chain,
  // waits until that destination tx is mined,
  // returns finalization metadata for UI / explorers.
  const finalize = (h: InteropWaitable | Hex): Promise<InteropFinalizationResult> =>
    wrap(
      OP_INTEROP.finalize,
      async () => {
        const svc = createInteropFinalizationServices(client);
        const info = await svc.waitForFinalization(h);

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

  const tryFinalize = (h: InteropWaitable | Hex) =>
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
