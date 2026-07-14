import type {
  AtomicInteropBundlePayload,
  AtomicInteropBundleState,
  AtomicInteropFlow,
  AtomicInteropFlowParams,
  AtomicInteropIntent,
  AtomicInteropLegDraft,
  AtomicInteropLegState,
  InteropParams,
  InteropPhase,
} from '../../types/flows/interop';
import type { Address, Hex } from '../../types/primitives';
import { isAddress, isHash, isHash66 } from '../../utils';

const UINT64_MAX = (1n << 64n) - 1n;
export const ATOMIC_INTEROP_MAX_PREDECESSOR_WALK = 256;
export const ATOMIC_COMMIT_LEAF_TAG: Hex = '0x3445134c';

export interface AtomicInteropFlowHashInput {
  legBundleHashes: readonly Hex[];
  legSourceChainIds: readonly bigint[];
  deadline: bigint;
  settlementLayerChainId: bigint;
}

export interface AtomicInteropCommitHashInput {
  tag: Hex;
  flowId: Hex;
  bundleHash: Hex;
}

/** Adapter-owned ABI encoding and hashing capability for atomic protocol preimages. */
export interface AtomicInteropCodec {
  hashFlow(input: AtomicInteropFlowHashInput): Hex;
  hashCommit(input: AtomicInteropCommitHashInput): Hex;
}

export interface AtomicInteropPrimitives {
  defineFlow: (input: AtomicInteropFlowParams) => AtomicInteropFlow;
  bindFlow: (draft: AtomicInteropLegDraft, flow: AtomicInteropFlow) => AtomicInteropIntent;
  assertFlow: (flow: AtomicInteropFlow) => void;
  assertIntent: (intent: AtomicInteropIntent, context?: AtomicInteropIntentContext) => void;
  getCommitValue: (flowId: Hex, bundleHash: Hex) => bigint;
}

export interface AtomicInteropIntentContext {
  sender: Address;
  sourceChainId: bigint;
  destinationChainId: bigint;
  settlementLayerChainId: bigint;
}

export interface AtomicInteropTreeLeaf {
  value: bigint;
  nextIndex: bigint;
  nextValue: bigint;
}

export interface AtomicInteropTreeReader {
  leafCount(): Promise<bigint>;
  leafAt(index: bigint): Promise<AtomicInteropTreeLeaf>;
}

export interface ResolveAtomicInteropIndexInput {
  target: bigint;
  reader: AtomicInteropTreeReader;
  provider?: () => Promise<bigint | null | undefined>;
  maxWalk?: number;
}

export function createAtomicInteropPrimitives(codec: AtomicInteropCodec): AtomicInteropPrimitives {
  return {
    defineFlow: (input) => defineAtomicInteropFlow(codec, input),
    bindFlow: (draft, flow) => bindAtomicInteropFlow(codec, draft, flow),
    assertFlow: (flow) => assertAtomicInteropFlow(codec, flow),
    assertIntent: (intent, context) => assertAtomicInteropIntent(codec, intent, context),
    getCommitValue: (flowId, bundleHash) => getAtomicInteropCommitValue(codec, flowId, bundleHash),
  };
}

export function assertInteropParams(params: InteropParams): void {
  assertDeadline(params.deadline);
  if (params.settlementLayerChainId != null && params.settlementLayerChainId <= 0n) {
    throw new Error('settlementLayerChainId must be greater than zero.');
  }
  if (!Array.isArray(params.actions) || params.actions.length === 0) {
    throw new Error('Atomic interop requires at least one action.');
  }

  for (const action of params.actions) {
    if (!isAddress(action.to)) throw new Error(`Invalid interop recipient: ${String(action.to)}.`);
    if (action.type === 'sendErc20') {
      if (!isAddress(action.token))
        throw new Error(`Invalid ERC-20 token: ${String(action.token)}.`);
      if (action.amount <= 0n) throw new Error('sendErc20.amount must be greater than zero.');
      continue;
    }
    if (action.type === 'call') {
      if (!isHash(action.data) || (action.data.length - 2) % 2 !== 0) {
        throw new Error('call.data must be a 0x-prefixed even-length hex value.');
      }
      if ((action as { value?: unknown }).value != null) {
        throw new Error('Native call value is not enabled for atomic interop.');
      }
      if (action.recovery?.protocol !== 'IAtomicRecoverable') {
        throw new Error('Atomic arbitrary calls require recovery.protocol = "IAtomicRecoverable".');
      }
      continue;
    }
    throw new Error(
      `Unsupported atomic interop action: ${String((action as { type?: unknown }).type)}.`,
    );
  }
}

export function assertDeadline(deadline: bigint): void {
  if (deadline <= 0n || deadline > UINT64_MAX) {
    throw new Error(
      'Atomic interop deadline must be a positive uint64 settlement-layer timestamp.',
    );
  }
}

function defineAtomicInteropFlow(
  codec: AtomicInteropCodec,
  input: AtomicInteropFlowParams,
): AtomicInteropFlow {
  assertDeadline(input.deadline);
  if (input.legs.length === 0) throw new Error('Atomic interop flow requires at least one leg.');

  const inferredSettlementLayers = new Set(
    input.legs
      .map((leg) => leg.settlementLayerChainId)
      .filter((chainId): chainId is bigint => chainId != null),
  );
  const settlementLayerChainId =
    input.settlementLayerChainId ??
    (inferredSettlementLayers.size === 1 ? [...inferredSettlementLayers][0] : undefined);
  if (settlementLayerChainId == null || settlementLayerChainId <= 0n) {
    throw new Error(
      'settlementLayerChainId is required when it cannot be inferred from all leg drafts.',
    );
  }

  const pairs = input.legs.map((leg) => {
    if (!isHash66(leg.bundleHash)) {
      throw new Error(`Invalid leg bundle hash: ${String(leg.bundleHash)}.`);
    }
    if (leg.sourceChainId <= 0n) throw new Error('Leg sourceChainId must be greater than zero.');
    if (
      leg.settlementLayerChainId != null &&
      leg.settlementLayerChainId !== settlementLayerChainId
    ) {
      throw new Error('Every atomic interop leg must use the same settlement layer.');
    }
    return { bundleHash: leg.bundleHash.toLowerCase() as Hex, sourceChainId: leg.sourceChainId };
  });
  pairs.sort((a, b) => a.bundleHash.localeCompare(b.bundleHash));
  for (let i = 1; i < pairs.length; i += 1) {
    if (pairs[i - 1].bundleHash === pairs[i].bundleHash) {
      throw new Error(`Duplicate atomic interop bundle hash: ${pairs[i].bundleHash}.`);
    }
  }

  const legBundleHashes = pairs.map((pair) => pair.bundleHash);
  const legSourceChainIds = pairs.map((pair) => pair.sourceChainId);
  return {
    kind: 'atomic-interop-flow',
    version: 1,
    flowId: hashAtomicInteropFlow(codec, {
      legBundleHashes,
      legSourceChainIds,
      deadline: input.deadline,
      settlementLayerChainId,
    }),
    deadline: input.deadline,
    settlementLayerChainId,
    legBundleHashes,
    legSourceChainIds,
  };
}

function bindAtomicInteropFlow(
  codec: AtomicInteropCodec,
  draft: AtomicInteropLegDraft,
  flow: AtomicInteropFlow,
): AtomicInteropIntent {
  assertAtomicInteropLegDraft(draft);
  assertAtomicInteropFlow(codec, flow);
  if (draft.deadline !== flow.deadline) throw new Error('Draft and flow deadlines do not match.');
  if (draft.settlementLayerChainId !== flow.settlementLayerChainId) {
    throw new Error('Draft and flow settlement layers do not match.');
  }

  const index = flow.legBundleHashes.findIndex(
    (bundleHash) => bundleHash.toLowerCase() === draft.bundleHash.toLowerCase(),
  );
  if (index < 0 || flow.legSourceChainIds[index] !== draft.sourceChainId) {
    throw new Error('The local leg commitment is not present in the atomic flow.');
  }

  return { kind: 'atomic-interop-intent', version: 1, draft, flow };
}

export function assertAtomicInteropLegDraft(draft: AtomicInteropLegDraft): void {
  if (draft.kind !== 'atomic-interop-leg' || draft.version !== 1) {
    throw new Error('Unsupported atomic interop leg draft version.');
  }
  assertInteropParams(draft.params);
  if (!isAddress(draft.sender)) throw new Error('Atomic interop draft sender is invalid.');
  if (draft.sourceChainId <= 0n || draft.destinationChainId <= 0n) {
    throw new Error('Atomic interop draft chain IDs must be greater than zero.');
  }
  if (draft.sourceChainId === draft.destinationChainId) {
    throw new Error('Atomic interop source and destination chains must differ.');
  }
  if (draft.settlementLayerChainId <= 0n) {
    throw new Error('Atomic interop draft settlement layer must be greater than zero.');
  }
  if (draft.deadline !== draft.params.deadline) {
    throw new Error('Draft and params deadlines do not match.');
  }
  if (draft.params.settlementLayerChainId !== draft.settlementLayerChainId) {
    throw new Error('Draft and params settlement layers do not match.');
  }
  if (!isHash66(draft.salt)) throw new Error('Atomic interop draft salt must be bytes32.');
  if (!isHash66(draft.bundleHash)) {
    throw new Error('Atomic interop draft bundleHash must be bytes32.');
  }
  if (draft.route !== 'direct' && draft.route !== 'indirect') {
    throw new Error('Atomic interop draft route is invalid.');
  }
  if (!draft.commitment || typeof draft.commitment !== 'object') {
    throw new Error('Atomic interop draft commitment is missing.');
  }
  if (
    draft.commitment.bundleHash.toLowerCase() !== draft.bundleHash.toLowerCase() ||
    draft.commitment.sourceChainId !== draft.sourceChainId ||
    draft.commitment.settlementLayerChainId !== draft.settlementLayerChainId
  ) {
    throw new Error('Atomic interop draft commitment does not match its leg metadata.');
  }
  if (!draft.payload || typeof draft.payload !== 'object') {
    throw new Error('Atomic interop draft payload is missing.');
  }
  assertAtomicInteropPayloadShape(draft.payload);
}

export function assertAtomicInteropPayloadMatches(
  retained: AtomicInteropBundlePayload,
  rebuilt: AtomicInteropBundlePayload,
): void {
  assertAtomicInteropPayloadShape(retained);
  assertAtomicInteropPayloadShape(rebuilt);
  if (!atomicInteropPayloadsEqual(retained, rebuilt)) {
    throw new Error('Atomic interop intent payload no longer matches its local leg parameters.');
  }
}

function assertAtomicInteropFlow(codec: AtomicInteropCodec, flow: AtomicInteropFlow): void {
  if (flow.kind !== 'atomic-interop-flow' || flow.version !== 1) {
    throw new Error('Unsupported atomic interop flow version.');
  }
  if (flow.legBundleHashes.length !== flow.legSourceChainIds.length) {
    throw new Error('Atomic flow bundle-hash and source-chain arrays must have equal lengths.');
  }
  const canonical = defineAtomicInteropFlow(codec, {
    legs: flow.legBundleHashes.map((bundleHash, index) => ({
      bundleHash,
      sourceChainId: flow.legSourceChainIds[index],
      settlementLayerChainId: flow.settlementLayerChainId,
    })),
    deadline: flow.deadline,
    settlementLayerChainId: flow.settlementLayerChainId,
  });
  if (
    canonical.flowId.toLowerCase() !== flow.flowId.toLowerCase() ||
    canonical.legBundleHashes.some(
      (bundleHash, index) => bundleHash !== flow.legBundleHashes[index].toLowerCase(),
    )
  ) {
    throw new Error('Atomic interop flow is not canonically ordered or has an invalid flowId.');
  }
}

function assertAtomicInteropIntent(
  codec: AtomicInteropCodec,
  intent: AtomicInteropIntent,
  context?: AtomicInteropIntentContext,
): void {
  if (intent.kind !== 'atomic-interop-intent' || intent.version !== 1) {
    throw new Error('Unsupported atomic interop intent version.');
  }
  const rebound = bindAtomicInteropFlow(codec, intent.draft, intent.flow);
  if (rebound.flow.flowId.toLowerCase() !== intent.flow.flowId.toLowerCase()) {
    throw new Error('Atomic interop intent flow is invalid.');
  }
  if (!context) return;
  if (intent.draft.sender.toLowerCase() !== context.sender.toLowerCase()) {
    throw new Error('Atomic interop intent sender does not match the configured signer.');
  }
  if (intent.draft.sourceChainId !== context.sourceChainId) {
    throw new Error('Atomic interop intent source chain does not match this SDK instance.');
  }
  if (intent.draft.destinationChainId !== context.destinationChainId) {
    throw new Error('Atomic interop intent destination chain does not match dstChain.');
  }
  if (intent.flow.settlementLayerChainId !== context.settlementLayerChainId) {
    throw new Error('Atomic interop intent settlement layer does not match the configured L1.');
  }
}

export function isAtomicInteropIntent(value: unknown): value is AtomicInteropIntent {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'atomic-interop-intent'
  );
}

function hashAtomicInteropFlow(codec: AtomicInteropCodec, input: AtomicInteropFlowHashInput): Hex {
  if (input.legBundleHashes.length !== input.legSourceChainIds.length) {
    throw new Error('Atomic flow arrays must have equal lengths.');
  }
  const hash = codec.hashFlow(input);
  assertCodecHash(hash, 'flow');
  return hash.toLowerCase() as Hex;
}

function getAtomicInteropCommitValue(
  codec: AtomicInteropCodec,
  flowId: Hex,
  bundleHash: Hex,
): bigint {
  if (!isHash66(flowId)) throw new Error(`Expected flowId bytes32, received ${String(flowId)}.`);
  if (!isHash66(bundleHash)) {
    throw new Error(`Expected bundleHash bytes32, received ${String(bundleHash)}.`);
  }
  const hash = codec.hashCommit({ tag: ATOMIC_COMMIT_LEAF_TAG, flowId, bundleHash });
  assertCodecHash(hash, 'commit');
  return BigInt(hash);
}

export async function resolveAtomicInteropIndex(
  input: ResolveAtomicInteropIndexInput,
): Promise<bigint> {
  if (input.target <= 0n) throw new Error('Atomic interop commit value must be non-zero.');
  const leafCount = await input.reader.leafCount();
  if (leafCount <= 0n) throw new Error('Atomic interop commitment tree is not initialized.');

  if (input.provider) {
    try {
      const provided = await input.provider();
      if (provided != null && provided >= 0n && provided < leafCount) {
        const leaf = await input.reader.leafAt(provided);
        assertTargetNotPresent(input.target, leaf);
        if (isPredecessor(input.target, leaf)) return provided;
      }
    } catch {
      // A stale or unavailable indexer falls back to the bounded on-chain walk.
    }
  }

  const maxWalk = input.maxWalk ?? ATOMIC_INTEROP_MAX_PREDECESSOR_WALK;
  if (!Number.isInteger(maxWalk) || maxWalk <= 0) {
    throw new Error('Atomic interop predecessor maxWalk must be a positive integer.');
  }

  let index = 0n;
  const visited = new Set<bigint>();
  for (let step = 0; step < maxWalk; step += 1) {
    if (index < 0n || index >= leafCount) {
      throw new Error(
        'Atomic interop commitment tree contains an out-of-bounds linked-list index.',
      );
    }
    if (visited.has(index)) throw new Error('Atomic interop commitment tree contains a cycle.');
    visited.add(index);

    const leaf = await input.reader.leafAt(index);
    assertTargetNotPresent(input.target, leaf);
    if (isPredecessor(input.target, leaf)) return index;
    if (leaf.nextValue === 0n || leaf.nextIndex === index) {
      throw new Error('Atomic interop commitment tree predecessor links are inconsistent.');
    }
    index = leaf.nextIndex;
  }

  throw new Error(
    `Atomic interop predecessor search exceeded ${maxWalk} leaves; configure an AtomicInteropIndexProvider.`,
  );
}

export function decodeAtomicInteropLegState(
  raw: number | bigint,
): AtomicInteropLegState | 'UNKNOWN' {
  return (['UNSET', 'COMMITTED', 'REVERTABLE', 'REVERTED'] as const)[Number(raw)] ?? 'UNKNOWN';
}

export function decodeAtomicInteropBundleState(
  raw: number | bigint,
): AtomicInteropBundleState | 'UNKNOWN' {
  return (
    (['UNRECEIVED', 'VERIFIED', 'FULLY_EXECUTED', 'UNBUNDLED'] as const)[Number(raw)] ?? 'UNKNOWN'
  );
}

export function mapAtomicInteropPhase(
  legState: AtomicInteropLegState | 'UNKNOWN',
  bundleState: AtomicInteropBundleState | 'UNKNOWN',
): InteropPhase {
  if (legState === 'UNKNOWN' || bundleState === 'UNKNOWN') return 'UNKNOWN';
  const destinationProgressed = bundleState !== 'UNRECEIVED';
  if (
    (legState === 'UNSET' || legState === 'REVERTABLE' || legState === 'REVERTED') &&
    destinationProgressed
  ) {
    return 'INCONSISTENT';
  }
  if (bundleState === 'FULLY_EXECUTED') return 'EXECUTED';
  if (bundleState === 'UNBUNDLED') return 'UNBUNDLED';
  if (bundleState === 'VERIFIED') return 'VERIFIED';
  if (legState === 'REVERTED') return 'REFUNDED';
  if (legState === 'REVERTABLE') return 'REFUNDABLE';
  if (legState === 'COMMITTED') return 'COMMITTED';
  return 'UNSET';
}

export function withAtomicBundleAttribute(
  payload: AtomicInteropBundlePayload,
  atomicAttribute: Hex,
): AtomicInteropBundlePayload {
  return {
    ...payload,
    starters: payload.starters.map((starter) => [starter[0], starter[1], [...starter[2]]] as const),
    bundleAttributes: [...payload.bundleAttributes, atomicAttribute],
  };
}

export function isStaleAtomicInteropIndexErrorName(name: string | undefined): boolean {
  return (
    name === 'IMTLowLeafIndexOutOfBounds' ||
    name === 'IMTLowLeafNextTooSmall' ||
    name === 'IMTLowLeafValueTooLarge'
  );
}

function isPredecessor(target: bigint, leaf: AtomicInteropTreeLeaf): boolean {
  return leaf.value < target && (leaf.nextValue === 0n || target < leaf.nextValue);
}

function assertAtomicInteropPayloadShape(payload: AtomicInteropBundlePayload): void {
  if (!isHash(payload.destinationChain)) {
    throw new Error('Atomic interop payload destination chain must be hex data.');
  }
  if (payload.value < 0n) throw new Error('Atomic interop payload value cannot be negative.');
  for (const starter of payload.starters) {
    if (
      starter.length !== 3 ||
      !isHash(starter[0]) ||
      !isHash(starter[1]) ||
      starter[2].some((attribute) => !isHash(attribute))
    ) {
      throw new Error('Atomic interop payload contains a malformed call starter.');
    }
  }
  if (payload.bundleAttributes.some((attribute) => !isHash(attribute))) {
    throw new Error('Atomic interop payload contains a malformed bundle attribute.');
  }
}

function atomicInteropPayloadsEqual(
  left: AtomicInteropBundlePayload,
  right: AtomicInteropBundlePayload,
): boolean {
  if (
    left.destinationChain.toLowerCase() !== right.destinationChain.toLowerCase() ||
    left.value !== right.value ||
    left.bundleAttributes.length !== right.bundleAttributes.length ||
    left.starters.length !== right.starters.length
  ) {
    return false;
  }
  if (
    left.bundleAttributes.some(
      (attribute, index) => attribute.toLowerCase() !== right.bundleAttributes[index].toLowerCase(),
    )
  ) {
    return false;
  }
  return left.starters.every((starter, index) => {
    const other = right.starters[index];
    return (
      starter[0].toLowerCase() === other[0].toLowerCase() &&
      starter[1].toLowerCase() === other[1].toLowerCase() &&
      starter[2].length === other[2].length &&
      starter[2].every(
        (attribute, attributeIndex) =>
          attribute.toLowerCase() === other[2][attributeIndex].toLowerCase(),
      )
    );
  });
}

function assertTargetNotPresent(target: bigint, leaf: AtomicInteropTreeLeaf): void {
  if (leaf.value === target || leaf.nextValue === target) {
    throw new Error('Atomic interop commit value already exists in the commitment tree.');
  }
}

function assertCodecHash(value: Hex, operation: 'flow' | 'commit'): void {
  if (!isHash66(value)) {
    throw new Error(`Atomic interop codec returned an invalid ${operation} bytes32 hash.`);
  }
}
