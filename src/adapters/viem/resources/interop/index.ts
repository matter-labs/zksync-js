import type { ViemClient } from '../../client';
import type { Hex } from '../../../../core/types/primitives';
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
import type { TokensResource } from '../../../../core/types/flows/token';
import type { ContractsResource } from '../contracts';
import type { WriteContractParameters } from 'viem';

import { commonCtx } from './context';
import { routeIndirect } from './routes/indirect';
import { routeDirect } from './routes/direct';
import type { InteropRouteStrategy, ViemPlanWriteRequest } from './routes/types';
import { createTokensResource } from '../tokens';
import { createContractsResource } from '../contracts';
import { isZKsyncError, OP_INTEROP } from '../../../../core/types/errors';
import { createError } from '../../../../core/errors/factory';
import { createErrorHandlers } from '../../errors/error-ops';
import {
  status as interopStatus,
  wait as interopWait,
  createInteropFinalizationServices,
} from './services/finalization';

const { wrap, toResult } = createErrorHandlers('interop');

export const ROUTES: Record<InteropRoute, InteropRouteStrategy> = {
  direct: routeDirect(),
  indirect: routeIndirect(),
};

export interface InteropResource {
  quote(p: InteropParams): Promise<InteropQuote>;

  tryQuote(
    p: InteropParams,
  ): Promise<{ ok: true; value: InteropQuote } | { ok: false; error: unknown }>;

  prepare(p: InteropParams): Promise<InteropPlan<ViemPlanWriteRequest>>;

  tryPrepare(
    p: InteropParams,
  ): Promise<{ ok: true; value: InteropPlan<ViemPlanWriteRequest> } | { ok: false; error: unknown }>;

  create(p: InteropParams): Promise<InteropHandle<ViemPlanWriteRequest>>;

  tryCreate(
    p: InteropParams,
  ): Promise<
    { ok: true; value: InteropHandle<ViemPlanWriteRequest> } | { ok: false; error: unknown }
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

export function createInteropResource(
  client: ViemClient,
  tokens?: TokensResource,
  contracts?: ContractsResource,
): InteropResource {
  const tokensResource = tokens ?? createTokensResource(client);
  const contractsResource = contracts ?? createContractsResource(client);

  async function buildPlan(p: InteropParams): Promise<InteropPlan<ViemPlanWriteRequest>> {
    const ctx = await commonCtx(p, client, tokensResource, contractsResource);
    const route = ctx.route;

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

    const { steps, approvals, quoteExtras } = await wrap(
      route === 'direct' ? OP_INTEROP.routes.direct.build : OP_INTEROP.routes.indirect.build,
      () => ROUTES[route].build(p, ctx),
      {
        message: 'Failed to build interop route plan.',
        ctx: { where: `routes.${route}.build`, dst: p.dst },
      },
    );

    const summary: InteropQuote = {
      route,
      approvalsNeeded: approvals,
      totalActionValue: quoteExtras.totalActionValue,
      bridgedTokenTotal: quoteExtras.bridgedTokenTotal,
    };

    return { route, summary, steps };
  }

  const quote = (p: InteropParams): Promise<InteropQuote> =>
    wrap(OP_INTEROP.quote, async () => {
      const plan = await buildPlan(p);
      return plan.summary;
    });

  const tryQuote = (p: InteropParams) =>
    toResult<InteropQuote>(OP_INTEROP.tryQuote, () => quote(p));

  const prepare = (p: InteropParams): Promise<InteropPlan<ViemPlanWriteRequest>> =>
    wrap(OP_INTEROP.prepare, () => buildPlan(p), {
      message: 'Internal error while preparing an interop plan.',
      ctx: { where: 'interop.prepare', dst: p.dst },
    });

  const tryPrepare = (p: InteropParams) =>
    toResult<InteropPlan<ViemPlanWriteRequest>>(OP_INTEROP.tryPrepare, () => prepare(p));

  const create = (p: InteropParams): Promise<InteropHandle<ViemPlanWriteRequest>> =>
    wrap(
      OP_INTEROP.create,
      async () => {
        const plan = await prepare(p);

        const wallet = await client.walletFor();
        const from = client.account.address;
        let next = await client.l2.getTransactionCount({ address: from, blockTag: 'latest' });

        const stepHashes: Record<string, Hex> = {};

        for (const step of plan.steps) {
          const nonce = next++;

          const baseReq = {
            address: step.tx.address,
            abi: step.tx.abi,
            functionName: step.tx.functionName,
            args: step.tx.args,
            account: step.tx.account ?? client.account,
            gas: step.tx.gas,
            nonce,
            ...(step.tx.maxFeePerGas != null ? { maxFeePerGas: step.tx.maxFeePerGas } : {}),
            ...(step.tx.maxPriorityFeePerGas != null
              ? { maxPriorityFeePerGas: step.tx.maxPriorityFeePerGas }
              : {}),
            ...(step.tx.dataSuffix ? { dataSuffix: step.tx.dataSuffix } : {}),
            ...(step.tx.chain ? { chain: step.tx.chain } : {}),
          } as Omit<WriteContractParameters, 'value'>;

          const req: WriteContractParameters =
            step.tx.value != null
              ? ({ ...baseReq, value: step.tx.value } as WriteContractParameters)
              : (baseReq as WriteContractParameters);

          let hash: Hex | undefined;
          try {
            hash = await wallet.writeContract(req);
            stepHashes[step.key] = hash;

            const rcpt = await client.l2.waitForTransactionReceipt({ hash });
            if (!rcpt || rcpt.status !== 'success') {
              throw createError('EXECUTION', {
                resource: 'interop',
                operation: 'interop.create.writeContract',
                message: 'Interop transaction reverted on source L2.',
                context: { step: step.key, txHash: hash, status: rcpt?.status },
              });
            }
          } catch (e) {
            if (isZKsyncError(e)) throw e;
            throw createError('EXECUTION', {
              resource: 'interop',
              operation: 'interop.create.writeContract',
              message: 'Failed to send or confirm an interop transaction step.',
              context: { step: step.key, txHash: hash, nonce },
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
    toResult<InteropHandle<ViemPlanWriteRequest>>(OP_INTEROP.tryCreate, () => create(p));

  const status = (h: InteropWaitable | Hex): Promise<InteropStatus> =>
    wrap(OP_INTEROP.status, () => interopStatus(client, h), {
      message: 'Internal error while checking interop status.',
      ctx: { where: 'interop.status' },
    });

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

  const finalize = (h: InteropWaitable | Hex): Promise<InteropFinalizationResult> =>
    wrap(
      OP_INTEROP.finalize,
      async () => {
        const svc = createInteropFinalizationServices(client);
        const info = await svc.waitForFinalization(h);

        const execResult = await svc.executeBundle(info);
        await execResult.wait();

        return {
          bundleHash: info.bundleHash,
          dstChainId: info.dstChainId,
          dstExecTxHash: execResult.hash,
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
