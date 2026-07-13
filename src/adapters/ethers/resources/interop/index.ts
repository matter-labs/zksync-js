import {
  AbiCoder,
  Contract,
  Interface,
  ZeroHash,
  keccak256,
  type AbstractProvider,
  type TransactionReceipt,
  type TransactionRequest,
} from 'ethers';

import type { EthersClient } from '../../client';
import type { ContractsResource } from '../contracts';
import { createContractsResource } from '../contracts';
import { createTokensResource } from '../tokens';
import type { TokensResource } from '../../../../core/types/flows/token';
import type { AttributesResource } from '../../../../core/resources/interop/attributes/resource';
import { createEthersAttributesResource } from './attributes/resource';
import type {
  AtomicInteropBundlePayload,
  AtomicInteropDeadlineParams,
  AtomicInteropFlow,
  AtomicInteropFlowParams,
  AtomicInteropIntent,
  AtomicInteropLegDraft,
  InteropApprovalResult,
  InteropHandle,
  InteropInput,
  InteropParams,
  InteropPlan,
  InteropQuote,
  InteropRoute,
  InteropStatus,
} from '../../../../core/types/flows/interop';
import type { ApprovalNeed, PlanStep } from '../../../../core/types/flows/base';
import type { Address, Hex } from '../../../../core/types/primitives';
import {
  assertAtomicInteropIntent,
  assertAtomicInteropPayloadMatches,
  assertDeadline,
  assertInteropParams,
  bindAtomicInteropFlow,
  decodeAtomicInteropBundleState,
  decodeAtomicInteropLegState,
  defineAtomicInteropFlow,
  getAtomicInteropCommitValue,
  isAtomicInteropIntent,
  isStaleAtomicInteropIndexErrorName,
  mapAtomicInteropPhase,
  resolveAtomicInteropIndex,
  withAtomicBundleAttribute,
} from '../../../../core/resources/interop/atomic';
import { pickInteropRoute } from '../../../../core/resources/interop/route';
import type {
  InteropAtomicSend,
  InteropBundleBuild,
} from '../../../../core/resources/interop/plan';
import {
  executePlan,
  type PlanExecutionResult,
} from '../../../../core/internal/cross-chain/execution';
import { generateBundleSalt } from '../../../../core/internal/cross-chain/salt';
import {
  IAtomicFlowManagerABI,
  IERC20ABI,
  IInteropCenterABI,
  IInteropHandlerABI,
  IL2InteropCommitmentTreeABI,
} from '../../../../core/abi';
import {
  L2_ATOMIC_FLOW_MANAGER_ADDRESS,
  L2_INTEROP_COMMITMENT_TREE_ADDRESS,
  L2_INTEROP_HANDLER_ADDRESS,
} from '../../../../core/constants';
import { isZKsyncError, OP_INTEROP } from '../../../../core/types';
import { isHash66 } from '../../../../core/utils';
import { createError } from '../../../../core/errors/factory';
import { createErrorHandlers, toZKsyncError } from '../../errors/error-ops';
import { decodeRevert } from '../../errors/revert';
import { commonCtx, type BuildCtx } from './context';
import { resolveChainRef } from './resolvers';
import { routeDirect } from './routes/direct';
import { routeIndirect } from './routes/indirect';
import type { InteropRouteStrategy } from './routes/types';
import { quoteStepsL2Fee } from './services/gas';
import { buildApproveSteps } from './services/erc20';
import type { ChainRef, InteropConfig } from './types';

const { wrap, toResult } = createErrorHandlers('interop');

export const ROUTES: Record<InteropRoute, InteropRouteStrategy> = {
  direct: routeDirect(),
  indirect: routeIndirect(),
};

export interface InteropResource {
  quote(dstChain: ChainRef, input: InteropInput): Promise<InteropQuote>;
  tryQuote(
    dstChain: ChainRef,
    input: InteropInput,
  ): Promise<{ ok: true; value: InteropQuote } | { ok: false; error: unknown }>;
  prepare(dstChain: ChainRef, input: InteropInput): Promise<InteropPlan<TransactionRequest>>;
  tryPrepare(
    dstChain: ChainRef,
    input: InteropInput,
  ): Promise<{ ok: true; value: InteropPlan<TransactionRequest> } | { ok: false; error: unknown }>;
  create(dstChain: ChainRef, input: InteropInput): Promise<InteropHandle<TransactionRequest>>;
  tryCreate(
    dstChain: ChainRef,
    input: InteropInput,
  ): Promise<
    { ok: true; value: InteropHandle<TransactionRequest> } | { ok: false; error: unknown }
  >;
  approve(dstChain: ChainRef, params: InteropParams): Promise<InteropApprovalResult>;
  previewLeg(dstChain: ChainRef, params: InteropParams): Promise<AtomicInteropLegDraft>;
  defineFlow(params: AtomicInteropFlowParams): AtomicInteropFlow;
  bindFlow(draft: AtomicInteropLegDraft, flow: AtomicInteropFlow): AtomicInteropIntent;
  getSettlementDeadline(params: AtomicInteropDeadlineParams): Promise<bigint>;
  status(
    dstChain: ChainRef,
    input: AtomicInteropIntent | InteropHandle<unknown>,
  ): Promise<InteropStatus>;
}

interface InteropInternalDependencies {
  generateSalt?: () => Hex;
}

interface Material {
  ctx: BuildCtx;
  params: InteropParams;
  route: InteropRoute;
  bundle: InteropBundleBuild;
  steps: Array<PlanStep<TransactionRequest>>;
  approvals: ApprovalNeed[];
  summary: InteropQuote;
}

interface ExecutedSteps {
  execution: PlanExecutionResult;
  receipts: Map<string, TransactionReceipt>;
}

interface EthersCommitmentTreeLeaf {
  value: bigint;
  nextIndex: bigint;
  nextValue: bigint;
}

interface EthersEmittedInteropBundle {
  sourceChainId: bigint;
  destinationChainId: bigint;
  bundleAttributes: { salt: Hex };
}

export function createInteropResource(
  client: EthersClient,
  config: InteropConfig = {},
  tokens?: TokensResource,
  contracts?: ContractsResource,
  attributes?: AttributesResource,
  internal: InteropInternalDependencies = {},
): InteropResource {
  const tokensResource = tokens ?? createTokensResource(client);
  const contractsResource = contracts ?? createContractsResource(client);
  const attributesResource = attributes ?? createEthersAttributesResource();
  const saltGenerator = internal.generateSalt ?? generateBundleSalt;

  async function settlementLayerChainId(): Promise<bigint> {
    return (await client.l1.getNetwork()).chainId;
  }

  async function buildMaterial(
    dstProvider: AbstractProvider,
    params: InteropParams,
    bundleSalt: Hex,
    atomic?: InteropAtomicSend,
  ): Promise<Material> {
    assertInteropParams(params);
    if (!isHash66(bundleSalt)) throw new Error('Atomic interop salt must be bytes32.');

    const slChainId = await settlementLayerChainId();
    if (params.settlementLayerChainId != null && params.settlementLayerChainId !== slChainId) {
      throw new Error('Atomic interop settlementLayerChainId must match the configured L1.');
    }
    const normalizedParams: InteropParams = {
      ...params,
      settlementLayerChainId: slChainId,
    };
    const ctx = await commonCtx(
      dstProvider,
      normalizedParams,
      client,
      tokensResource,
      contractsResource,
      attributesResource,
    );
    const route = pickInteropRoute({
      actions: normalizedParams.actions,
      ctx: {
        sender: ctx.sender,
        srcChainId: ctx.chainId,
        dstChainId: ctx.dstChainId,
        baseTokenSrc: ctx.baseTokens.src,
        baseTokenDst: ctx.baseTokens.dst,
      },
    });

    await ROUTES[route].preflight(normalizedParams, ctx);
    const built = await ROUTES[route].build(normalizedParams, ctx, { bundleSalt, atomic });
    const l2Fee = await quoteStepsL2Fee(built.steps, ctx).catch(() => undefined);
    return {
      ctx,
      params: normalizedParams,
      route,
      bundle: built.bundle,
      steps: built.steps,
      approvals: built.approvals,
      summary: {
        route,
        approvalsNeeded: built.approvals,
        totalActionValue: built.quoteExtras.totalActionValue,
        bridgedTokenTotal: built.quoteExtras.bridgedTokenTotal,
        interopFee: built.interopFee,
        deadline: normalizedParams.deadline,
        settlementLayerChainId: slChainId,
        l2Fee,
      },
    };
  }

  async function isSaltUsed(ctx: BuildCtx, salt: Hex): Promise<boolean> {
    const center = new Contract(ctx.interopCenter, IInteropCenterABI, client.l2);
    return Boolean(await center.isInteropBundleSaltUsed(ctx.sender, salt));
  }

  async function freshMaterial(
    dstProvider: AbstractProvider,
    params: InteropParams,
  ): Promise<{ material: Material; salt: Hex }> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const salt = saltGenerator();
      const material = await buildMaterial(dstProvider, params, salt);
      if (!(await isSaltUsed(material.ctx, salt))) return { material, salt };
    }
    throw new Error('Failed to generate an unused atomic interop bundle salt.');
  }

  function payloadFrom(material: Material): AtomicInteropBundlePayload {
    return {
      destinationChain: material.bundle.dstChain,
      starters: material.bundle.starters.map(
        (starter) => [starter[0], starter[1], [...starter[2]]] as const,
      ),
      bundleAttributes: [...material.bundle.bundleAttributes],
      value: material.bundle.quoteExtras.totalActionValue + material.bundle.interopFee.amount,
    };
  }

  async function assertDeadlineIsFuture(deadline: bigint): Promise<void> {
    assertDeadline(deadline);
    const block = await client.l1.getBlock('latest');
    if (!block) throw new Error('Unable to read the latest settlement-layer block.');
    if (deadline <= BigInt(block.timestamp)) {
      throw new Error('Atomic interop deadline must be in the future on the settlement layer.');
    }
  }

  async function assertAllowances(
    material: Material,
    options: { hashAffectingOnly: boolean; operation: string },
  ): Promise<void> {
    for (const approval of material.approvals) {
      if (
        options.hashAffectingOnly &&
        approval.spender.toLowerCase() !== material.ctx.l2NativeTokenVault.toLowerCase()
      ) {
        continue;
      }
      const token = new Contract(approval.token, IERC20ABI, client.l2);
      const allowance = (await token.allowance(material.ctx.sender, approval.spender)) as bigint;
      if (allowance < approval.amount) {
        throw createError('VALIDATION', {
          resource: 'interop',
          operation: options.operation,
          message:
            'Atomic interop requires the ERC-20 allowances reported by quote. Call interop.approve before previewLeg or prepare.',
          context: {
            token: approval.token,
            spender: approval.spender,
            required: approval.amount,
            allowance,
          },
        });
      }
    }
  }

  async function previewFrom(material: Material, salt: Hex): Promise<AtomicInteropLegDraft> {
    await assertDeadlineIsFuture(material.params.deadline);
    await assertAllowances(material, {
      hashAffectingOnly: true,
      operation: OP_INTEROP.previewLeg,
    });
    const payload = payloadFrom(material);
    const center = new Contract(
      material.ctx.interopCenter,
      IInteropCenterABI,
      client.getL2Signer(),
    );
    const bundleHash = (await center
      .getFunction('previewBundleHash')
      .staticCall(payload.destinationChain, payload.starters, payload.bundleAttributes)) as Hex;
    if (!isHash66(bundleHash))
      throw new Error('InteropCenter.previewBundleHash returned invalid data.');

    const commitment = {
      bundleHash,
      sourceChainId: material.ctx.chainId,
      settlementLayerChainId: material.params.settlementLayerChainId,
    };
    return {
      kind: 'atomic-interop-leg',
      version: 1,
      sender: material.ctx.sender,
      sourceChainId: material.ctx.chainId,
      destinationChainId: material.ctx.dstChainId,
      settlementLayerChainId: material.params.settlementLayerChainId!,
      deadline: material.params.deadline,
      salt,
      route: material.route,
      params: material.params,
      payload,
      bundleHash,
      commitment,
    };
  }

  async function materialForIntent(
    dstProvider: AbstractProvider,
    intent: AtomicInteropIntent,
  ): Promise<Material> {
    const material = await buildMaterial(dstProvider, intent.draft.params, intent.draft.salt);
    assertAtomicInteropIntent(intent, {
      sender: material.ctx.sender,
      sourceChainId: material.ctx.chainId,
      destinationChainId: material.ctx.dstChainId,
      settlementLayerChainId: material.params.settlementLayerChainId!,
    });
    if (intent.draft.route !== material.route) {
      throw new Error('Atomic interop intent route no longer matches its local leg parameters.');
    }
    assertAtomicInteropPayloadMatches(intent.draft.payload, payloadFrom(material));
    return material;
  }

  async function previewInput(
    dstProvider: AbstractProvider,
    input: InteropInput,
  ): Promise<{ intent: AtomicInteropIntent; material: Material }> {
    if (isAtomicInteropIntent(input)) {
      const material = await materialForIntent(dstProvider, input);
      if (await isSaltUsed(material.ctx, input.draft.salt)) {
        throw new Error('Atomic interop intent salt has already been used by this sender.');
      }
      const previewed = await previewFrom(material, input.draft.salt);
      if (previewed.bundleHash.toLowerCase() !== input.draft.bundleHash.toLowerCase()) {
        throw new Error('Atomic interop intent no longer previews to its committed bundleHash.');
      }
      return { intent: input, material };
    }

    const { material, salt } = await freshMaterial(dstProvider, input);
    const draft = await previewFrom(material, salt);
    const flow = defineAtomicInteropFlow({
      legs: [draft],
      deadline: draft.deadline,
      settlementLayerChainId: draft.settlementLayerChainId,
    });
    return { intent: bindAtomicInteropFlow(draft, flow), material };
  }

  async function resolveIndex(intent: AtomicInteropIntent): Promise<bigint> {
    const commitValue = getAtomicInteropCommitValue(intent.flow.flowId, intent.draft.bundleHash);
    const tree = new Contract(
      L2_INTEROP_COMMITMENT_TREE_ADDRESS,
      IL2InteropCommitmentTreeABI,
      client.l2,
    );
    const request = {
      sourceChainId: intent.draft.sourceChainId,
      flowId: intent.flow.flowId,
      bundleHash: intent.draft.bundleHash,
      commitValue,
    };
    return resolveAtomicInteropIndex({
      target: commitValue,
      provider: config.indexProvider ? () => config.indexProvider!(request) : undefined,
      reader: {
        leafCount: async () => (await tree.leafCount()) as bigint,
        leafAt: async (index) => {
          const leaf = (await tree.leafAt(index)) as unknown as EthersCommitmentTreeLeaf;
          return {
            value: leaf.value,
            nextIndex: leaf.nextIndex,
            nextValue: leaf.nextValue,
          };
        },
      },
    });
  }

  function assertExperimentalSend(operation: string): void {
    if (!config.enableExperimentalAtomicSend) {
      throw createError('VALIDATION', {
        resource: 'interop',
        operation,
        message:
          'Atomic interop sends are experimental. Set interop.enableExperimentalAtomicSend to true to use prepare or create.',
      });
    }
  }

  async function prepareIntent(
    dstProvider: AbstractProvider,
    intent: AtomicInteropIntent,
    lowNullifierIndex: bigint,
  ): Promise<InteropPlan<TransactionRequest>> {
    const atomic: InteropAtomicSend = {
      flowId: intent.flow.flowId,
      deadline: intent.flow.deadline,
      lowNullifierIndex,
    };
    const material = await buildMaterial(
      dstProvider,
      intent.draft.params,
      intent.draft.salt,
      atomic,
    );
    const payload = withAtomicBundleAttribute(
      intent.draft.payload,
      attributesResource.bundle.atomicBundle(
        intent.flow.flowId,
        intent.flow.deadline,
        lowNullifierIndex,
      ),
    );
    return {
      route: material.route,
      summary: {
        ...material.summary,
        bundleHash: intent.draft.bundleHash,
        flowId: intent.flow.flowId,
      },
      steps: material.steps,
      intent,
      payload,
      bundleHash: intent.draft.bundleHash,
      flowId: intent.flow.flowId,
      lowNullifierIndex,
    };
  }

  async function startingNonce(ctx: BuildCtx, params: InteropParams): Promise<number> {
    const configured = params.txOverrides?.nonce;
    if (typeof configured === 'number') return configured;
    const blockTag = configured ?? 'pending';
    return client.l2.getTransactionCount(ctx.sender, blockTag);
  }

  async function executeSteps(
    steps: readonly PlanStep<TransactionRequest>[],
    ctx: BuildCtx,
    initialNonce: number,
  ): Promise<ExecutedSteps> {
    const signer = client.getL2Signer();
    const receipts = new Map<string, TransactionReceipt>();
    const execution = await executePlan({
      steps,
      initialNonce,
      executeStep: async ({ step, nonce }) => {
        const tx: TransactionRequest = { ...step.tx, nonce };
        if (tx.chainId == null) tx.chainId = Number(ctx.chainId);
        if (tx.gasLimit == null) {
          try {
            tx.gasLimit =
              ((await client.l2.estimateGas({ ...tx, from: ctx.sender })) * 115n) / 100n;
          } catch {
            // The send path reports the contract error with its full context.
          }
        }

        let hash: Hex | undefined;
        try {
          const sent = await signer.sendTransaction(tx);
          hash = sent.hash as Hex;
          const receipt = await sent.wait();
          if (!receipt || receipt.status === 0) {
            throw createError('EXECUTION', {
              resource: 'interop',
              operation: OP_INTEROP.exec.waitStep,
              message: 'Atomic interop transaction reverted on source L2.',
              context: { step: step.key, txHash: hash },
            });
          }
          receipts.set(step.key, receipt);
          return hash;
        } catch (error) {
          if (isZKsyncError(error)) throw error;
          throw toZKsyncError(
            'EXECUTION',
            {
              resource: 'interop',
              operation: OP_INTEROP.exec.sendStep,
              message: 'Failed to send or confirm an atomic interop transaction step.',
              context: { step: step.key, txHash: hash, nonce },
            },
            error,
          );
        }
      },
    });
    return { execution, receipts };
  }

  async function simulateSend(ctx: BuildCtx, step: PlanStep<TransactionRequest>): Promise<void> {
    await client.l2.call({ ...step.tx, from: ctx.sender });
  }

  function parseBundleReceipt(
    receipt: TransactionReceipt,
    ctx: BuildCtx,
    intent: AtomicInteropIntent,
  ): Hex {
    const iface = new Interface(IInteropCenterABI);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== ctx.interopCenter.toLowerCase()) continue;
      let parsed;
      try {
        parsed = iface.parseLog({ data: log.data, topics: [...log.topics] });
      } catch {
        continue;
      }
      if (parsed?.name !== 'InteropBundleSent') continue;

      const l2l1MsgHash = parsed.args[0] as Hex;
      const emittedHash = parsed.args[1] as Hex;
      const bundle = parsed.args[2] as unknown as EthersEmittedInteropBundle;
      const event = iface.getEvent('InteropBundleSent');
      if (!event) throw new Error('InteropBundleSent event is missing from the ABI.');
      const encodedBundle = AbiCoder.defaultAbiCoder().encode([event.inputs[2]], [bundle]) as Hex;
      const sourceChainId = bundle.sourceChainId;
      const destinationChainId = bundle.destinationChainId;
      const computedHash = keccak256(
        AbiCoder.defaultAbiCoder().encode(['uint256', 'bytes'], [sourceChainId, encodedBundle]),
      ) as Hex;
      const rawSalt = bundle.bundleAttributes.salt;

      if (l2l1MsgHash.toLowerCase() !== ZeroHash) {
        throw new Error('Atomic interop unexpectedly emitted a public L2-to-L1 message hash.');
      }
      if (
        emittedHash.toLowerCase() !== intent.draft.bundleHash.toLowerCase() ||
        computedHash.toLowerCase() !== emittedHash.toLowerCase()
      ) {
        throw new Error('Emitted atomic interop bundle does not match its previewed bundleHash.');
      }
      if (
        sourceChainId !== intent.draft.sourceChainId ||
        destinationChainId !== intent.draft.destinationChainId ||
        rawSalt.toLowerCase() !== intent.draft.salt.toLowerCase()
      ) {
        throw new Error('Emitted atomic interop bundle fields do not match the local leg draft.');
      }
      return encodedBundle;
    }
    throw new Error('Failed to locate InteropBundleSent in the atomic interop source receipt.');
  }

  const quote = (dstChain: ChainRef, input: InteropInput): Promise<InteropQuote> =>
    wrap(OP_INTEROP.quote, async () => {
      const dstProvider = resolveChainRef(dstChain);
      if (isAtomicInteropIntent(input)) {
        const material = await materialForIntent(dstProvider, input);
        await assertDeadlineIsFuture(material.params.deadline);
        return {
          ...material.summary,
          bundleHash: input.draft.bundleHash,
          flowId: input.flow.flowId,
        };
      }
      const material = await buildMaterial(dstProvider, input, saltGenerator());
      await assertDeadlineIsFuture(material.params.deadline);
      return material.summary;
    });

  const tryQuote = (dstChain: ChainRef, input: InteropInput) =>
    toResult<InteropQuote>(OP_INTEROP.tryQuote, () => quote(dstChain, input));

  const prepare = (
    dstChain: ChainRef,
    input: InteropInput,
  ): Promise<InteropPlan<TransactionRequest>> =>
    wrap(OP_INTEROP.prepare, async () => {
      assertExperimentalSend(OP_INTEROP.prepare);
      const dstProvider = resolveChainRef(dstChain);
      const { intent } = await previewInput(dstProvider, input);
      return prepareIntent(dstProvider, intent, await resolveIndex(intent));
    });

  const tryPrepare = (dstChain: ChainRef, input: InteropInput) =>
    toResult<InteropPlan<TransactionRequest>>(OP_INTEROP.tryPrepare, () =>
      prepare(dstChain, input),
    );

  const approve = (dstChain: ChainRef, params: InteropParams): Promise<InteropApprovalResult> =>
    wrap(OP_INTEROP.approve, async () => {
      const material = await buildMaterial(resolveChainRef(dstChain), params, saltGenerator());
      await assertDeadlineIsFuture(material.params.deadline);
      const steps = [
        ...material.steps.filter((step) => step.kind === 'interop.ntv.ensure-token'),
        ...(await buildApproveSteps(material.approvals, material.ctx, { exact: true })),
      ];
      if (steps.length === 0) return { approvals: material.approvals, stepHashes: {} };
      const executed = await executeSteps(
        steps,
        material.ctx,
        await startingNonce(material.ctx, material.params),
      );
      return { approvals: material.approvals, stepHashes: executed.execution.stepHashes };
    });

  const previewLeg = (dstChain: ChainRef, params: InteropParams): Promise<AtomicInteropLegDraft> =>
    wrap(OP_INTEROP.previewLeg, async () => {
      const { material, salt } = await freshMaterial(resolveChainRef(dstChain), params);
      return previewFrom(material, salt);
    });

  const create = (
    dstChain: ChainRef,
    input: InteropInput,
  ): Promise<InteropHandle<TransactionRequest>> =>
    wrap(OP_INTEROP.create, async () => {
      assertExperimentalSend(OP_INTEROP.create);
      const dstProvider = resolveChainRef(dstChain);
      const existingIntent = isAtomicInteropIntent(input) ? input : undefined;
      const base = isAtomicInteropIntent(input)
        ? {
            material: await materialForIntent(dstProvider, input),
            salt: input.draft.salt,
          }
        : await freshMaterial(dstProvider, input);
      await assertDeadlineIsFuture(base.material.params.deadline);
      if (await isSaltUsed(base.material.ctx, base.salt)) {
        throw new Error('Atomic interop intent salt has already been used by this sender.');
      }

      const prerequisites = base.material.steps.filter((step) => step.key !== 'sendBundle');
      const nonce = await startingNonce(base.material.ctx, base.material.params);
      const prerequisiteExecution =
        prerequisites.length > 0
          ? await executeSteps(prerequisites, base.material.ctx, nonce)
          : {
              execution: { stepHashes: {}, nextNonce: nonce } satisfies PlanExecutionResult,
              receipts: new Map<string, TransactionReceipt>(),
            };

      await assertAllowances(base.material, {
        hashAffectingOnly: false,
        operation: OP_INTEROP.create,
      });

      const draft = await previewFrom(base.material, base.salt);
      let intent: AtomicInteropIntent;
      if (existingIntent) {
        if (draft.bundleHash.toLowerCase() !== existingIntent.draft.bundleHash.toLowerCase()) {
          throw new Error('Atomic interop intent no longer previews to its committed bundleHash.');
        }
        intent = existingIntent;
      } else {
        intent = bindAtomicInteropFlow(
          draft,
          defineAtomicInteropFlow({
            legs: [draft],
            deadline: draft.deadline,
            settlementLayerChainId: draft.settlementLayerChainId,
          }),
        );
      }

      let lowNullifierIndex = await resolveIndex(intent);
      let plan = await prepareIntent(dstProvider, intent, lowNullifierIndex);
      let sendStep = plan.steps.find((step) => step.key === 'sendBundle');
      if (!sendStep) throw new Error('Atomic interop plan is missing its sendBundle step.');

      try {
        await simulateSend(base.material.ctx, sendStep);
      } catch (error) {
        if (!isStaleAtomicInteropIndexErrorName(decodeRevert(error)?.name)) throw error;
        lowNullifierIndex = await resolveIndex(intent);
        plan = await prepareIntent(dstProvider, intent, lowNullifierIndex);
        sendStep = plan.steps.find((step) => step.key === 'sendBundle');
        if (!sendStep) throw new Error('Atomic interop retry plan is missing sendBundle.');
        await simulateSend(base.material.ctx, sendStep);
      }

      plan.steps = [...prerequisites, sendStep];
      const sent = await executeSteps(
        [sendStep],
        base.material.ctx,
        prerequisiteExecution.execution.nextNonce,
      );
      const receipt = sent.receipts.get('sendBundle');
      const l2SrcTxHash = sent.execution.sourceTxHash;
      if (!receipt || !l2SrcTxHash)
        throw new Error('Atomic interop send did not produce a receipt.');
      const encodedBundle = parseBundleReceipt(receipt, base.material.ctx, intent);

      return {
        kind: 'interop',
        route: plan.route,
        stepHashes: {
          ...prerequisiteExecution.execution.stepHashes,
          ...sent.execution.stepHashes,
        },
        plan,
        intent,
        l2SrcTxHash,
        bundleHash: intent.draft.bundleHash,
        encodedBundle,
      };
    });

  const tryCreate = (dstChain: ChainRef, input: InteropInput) =>
    toResult<InteropHandle<TransactionRequest>>(OP_INTEROP.tryCreate, () =>
      create(dstChain, input),
    );

  const getSettlementDeadline = (params: AtomicInteropDeadlineParams): Promise<bigint> =>
    wrap(OP_INTEROP.getSettlementDeadline, async () => {
      const afterSeconds = BigInt(params.afterSeconds);
      if (afterSeconds <= 0n) throw new Error('afterSeconds must be greater than zero.');
      const block = await client.l1.getBlock('latest');
      if (!block) throw new Error('Unable to read the latest settlement-layer block.');
      const deadline = BigInt(block.timestamp) + afterSeconds;
      assertDeadline(deadline);
      return deadline;
    });

  const status = (
    dstChain: ChainRef,
    input: AtomicInteropIntent | InteropHandle<unknown>,
  ): Promise<InteropStatus> =>
    wrap(OP_INTEROP.status, async () => {
      const intent = input.kind === 'interop' ? input.intent : input;
      const dstProvider = resolveChainRef(dstChain);
      const [sender, srcNetwork, dstNetwork, slNetwork] = await Promise.all([
        client.getL2Signer().getAddress(),
        client.l2.getNetwork(),
        dstProvider.getNetwork(),
        client.l1.getNetwork(),
      ]);
      assertAtomicInteropIntent(intent, {
        sender: sender as Address,
        sourceChainId: srcNetwork.chainId,
        destinationChainId: dstNetwork.chainId,
        settlementLayerChainId: slNetwork.chainId,
      });
      const manager = new Contract(
        L2_ATOMIC_FLOW_MANAGER_ADDRESS,
        IAtomicFlowManagerABI,
        client.l2,
      );
      const handler = new Contract(L2_INTEROP_HANDLER_ADDRESS, IInteropHandlerABI, dstProvider);
      const [rawLegState, rawBundleState] = await Promise.all([
        manager.legState(intent.flow.flowId, intent.draft.bundleHash) as Promise<bigint>,
        handler.bundleStatus(intent.draft.bundleHash) as Promise<bigint>,
      ]);
      const sourceState = decodeAtomicInteropLegState(rawLegState);
      const destinationState = decodeAtomicInteropBundleState(rawBundleState);
      return {
        phase: mapAtomicInteropPhase(sourceState, destinationState),
        flowId: intent.flow.flowId,
        bundleHash: intent.draft.bundleHash,
        sourceChainId: intent.draft.sourceChainId,
        destinationChainId: intent.draft.destinationChainId,
        source: {
          state: sourceState,
          txHash: input.kind === 'interop' ? input.l2SrcTxHash : undefined,
        },
        destination: { state: destinationState },
      };
    });

  return {
    quote,
    tryQuote,
    prepare,
    tryPrepare,
    create,
    tryCreate,
    approve,
    previewLeg,
    defineFlow: defineAtomicInteropFlow,
    bindFlow: bindAtomicInteropFlow,
    getSettlementDeadline,
    status,
  };
}
