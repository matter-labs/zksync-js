// src/adapters/ethers/resources/interop/index.ts
import type { EthersClient } from '../../client';
import type { Address, Hex } from '../../../../core/types/primitives';
import { createEthersAttributesResource } from './attributes';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import type { InteropParams, InteropRoute } from '../../../../core/types/flows/interop';
import type { ContractsResource } from '../contracts';
import { createTokensResource } from '../tokens';
import type { TokensResource } from '../../../../core/types/flows/token';
import { routeIndirect } from './routes/indirect';
import { routeDirect } from './routes/direct';
import type { InteropRouteStrategy } from './routes/types';
import type { TransactionReceiptZKsyncOS } from '../withdrawals/routes/types';
import type { TransactionReceipt } from 'ethers';

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
    opts: { for: 'l2' | 'ready' | 'finalized'; pollMs?: number; timeoutMs?: number },
  ): Promise<TransactionReceiptZKsyncOS | TransactionReceipt | null>;

  finalize(l2TxHash: Hex): Promise<{ status: InteropStatus; receipt?: TransactionReceipt }>;

  tryFinalize(
    l2TxHash: Hex,
  ): Promise<
    | { ok: true; value: { status: InteropStatus; receipt?: TransactionReceipt } }
    | { ok: false; error: unknown }
  >;
}

export function createInteropResource(
  _client: EthersClient,
  _tokens?: TokensResource,
  _contracts?: ContractsResource,
  attributes?: AttributesResource,
): InteropResource {
  const tokensResource = tokens ?? createTokensResource(client);
  const contractsResource = contracts ?? createContractsResource(client);
  const attributesResource = attributes ?? createEthersAttributesResource(client);

  async function buildPlan(p: InteropParams): Promise<InteropPlan<TransactionRequest>> {
    return {};
  }

  // quote, tryQuote, prepare, tryPrepare, create, tryCreate, status, wait, finalize, tryFinalize implementations go here
}
