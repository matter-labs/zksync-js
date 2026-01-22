import { Contract, type ContractTransactionResponse, Interface, type TransactionReceipt } from 'ethers';

import type { Hex } from '../../../../../core/types/primitives';
import type { EthersClient } from '../../../client';
import type {
    InteropStatus,
    InteropWaitable,
    InteropPhase,
} from '../../../../../core/types/flows/interop';

import { createErrorHandlers, toZKsyncError } from '../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../core/types';

// ABIs we need to decode events / send executeBundle()
import InteropCenterAbi from '../../../../../core/internal/abis/InteropCenter';
import IInteropHandlerAbi from '../../../../../core/internal/abis/IInteropHandler';

// error handling
const { wrap } = createErrorHandlers('interop');

/**
 * Internal: normalized identifiers we carry through status lookups.
 */
interface ResolvedInteropIds {
    l2SrcTxHash?: Hex;
    bundleHash?: Hex;
    dstChainId?: bigint;
    dstExecTxHash?: Hex;
}

/**
 * Normalize whatever the user gave into our internal ID set.
 */
function resolveIdsFromWaitable(input: InteropWaitable): ResolvedInteropIds {
    if (typeof input === 'string') {
        return { l2SrcTxHash: input };
    }

    const asObj = input as ResolvedInteropIds;

    return {
        l2SrcTxHash: asObj.l2SrcTxHash,
        bundleHash: asObj.bundleHash,
        dstChainId: asObj.dstChainId,
        dstExecTxHash: asObj.dstExecTxHash,
    };
}

/**
 * Internal helper:
 * Read the source-chain tx receipt for `l2SrcTxHash`, find the `InteropBundleSent`
 * event emitted by the InteropCenter, and decode:
 *   - interopBundleHash (the canonical bundle hash)
 *   - interopBundle.destinationChainId (EIP-155 of dest chain)
 */
async function parseBundleSentFromSource(args: {
    client: EthersClient;
    l2SrcTxHash: Hex;
}): Promise<{ bundleHash: Hex; dstChainId: bigint }> {
    const { client, l2SrcTxHash } = args;

    // Pull addresses we expect to see in the logs
    const { interopCenter } = await wrap(
        OP_INTEROP.svc.status.ensureAddresses,
        () => client.ensureAddresses(),
        {
            ctx: { where: 'ensureAddresses' },
            message: 'Failed to ensure interopCenter address.',
        },
    );

    // Fetch the source tx receipt (on the source L2)
    const receipt = await wrap(
        OP_INTEROP.svc.status.sourceReceipt,
        () => client.l2.getTransactionReceipt(l2SrcTxHash),
        {
            ctx: { where: 'l2.getTransactionReceipt', l2SrcTxHash },
            message: 'Failed to fetch source L2 receipt for interop tx.',
        },
    );
    if (!receipt) {
        throw toZKsyncError(
            'STATE',
            {
                resource: 'interop',
                operation: OP_INTEROP.svc.status.sourceReceipt,
                message: 'Source transaction receipt not found.',
                context: { l2SrcTxHash },
            },
            new Error('missing receipt'),
        );
    }

    // Build the interface to decode InteropBundleSent
    const centerIface = new Interface(InteropCenterAbi);
    const sentTopic = centerIface.getEvent('InteropBundleSent')!.topicHash as Hex;

    // Find the InteropBundleSent log in the receipt
    let foundLog: { data: Hex; topics: readonly Hex[] } | undefined;

    for (const log of receipt.logs ?? []) {
        const logAddr = (log.address ?? '').toLowerCase();
        const wantAddr = interopCenter.toLowerCase();

        const t0 = (log.topics?.[0] ?? '').toLowerCase();
        const wantTopic = sentTopic.toLowerCase();

        if (logAddr === wantAddr && t0 === wantTopic) {
            foundLog = {
                data: log.data as Hex,
                topics: log.topics as readonly Hex[],
            };
            break;
        }
    }

    if (!foundLog) {
        throw toZKsyncError(
            'STATE',
            {
                resource: 'interop',
                operation: OP_INTEROP.svc.status.parseSentLog,
                message: 'Failed to locate InteropBundleSent event in source receipt.',
                context: { l2SrcTxHash, interopCenter },
            },
            new Error('InteropBundleSent not found'),
        );
    }

    // Decode the event
    // event InteropBundleSent(
    //   bytes32 l2l1MsgHash,
    //   bytes32 interopBundleHash,
    //   InteropBundle interopBundle
    // );
    //
    // InteropBundle includes destinationChainId.
    const decoded = centerIface.decodeEventLog(
        'InteropBundleSent',
        foundLog.data,
        foundLog.topics,
    ) as unknown as {
        l2l1MsgHash: Hex;
        interopBundleHash: Hex;
        interopBundle: {
            destinationChainId: bigint;
        };
    };

    const bundleHash = decoded.interopBundleHash;
    const dstChainId = decoded.interopBundle.destinationChainId;

    return { bundleHash, dstChainId };
}

/**
 * Internal helper:
 * Look on the *destination* chain for the bundle lifecycle events and infer phase.
 *
 * Contracts:
 *   IInteropHandler on destination emits:
 *     event BundleVerified(bytes32 indexed bundleHash);
 *     event BundleExecuted(bytes32 indexed bundleHash);
 *     event BundleUnbundled(bytes32 indexed bundleHash);
 *
 * All three index bundleHash, so we can filter by topic[1] = bundleHash.
 *
 * Rules:
 *   UNBUNDLED beats EXECUTED
 *   EXECUTED beats VERIFIED
 *   If none seen, it's still SENT
 */
async function queryDstBundleLifecycle(args: {
    client: EthersClient;
    bundleHash: Hex;
    dstChainId: bigint;
}): Promise<{ phase: InteropPhase; dstExecTxHash?: Hex }> {
    const { client, bundleHash, dstChainId } = args;

    // get a provider for the destination chain
    const dstProvider = await wrap(
        OP_INTEROP.svc.status.requireDstProvider,
        () => client.requireProvider(dstChainId),
        {
            ctx: { where: 'requireProvider', dstChainId },
            message: 'Failed to acquire destination provider.',
        },
    );

    // get destination handler address
    const { interopHandler } = await wrap(
        OP_INTEROP.svc.status.ensureAddresses,
        () => client.ensureAddresses(),
        {
            ctx: { where: 'ensureAddresses' },
            message: 'Failed to ensure interopHandler address.',
        },
    );

    // Prepare iface and topics
    const handlerIface = new Interface(IInteropHandlerAbi);

    const verifiedTopic = handlerIface.getEvent('BundleVerified')!.topicHash as Hex;
    const executedTopic = handlerIface.getEvent('BundleExecuted')!.topicHash as Hex;
    const unbundledTopic = handlerIface.getEvent('BundleUnbundled')!.topicHash as Hex;

    // helper to fetch logs for a given event
    async function fetchLogsFor(eventTopic: Hex): Promise<
        Array<{
            txHash: Hex;
            rawTopics: readonly Hex[];
            rawData: Hex;
        }>
    > {
        // TODO: revisit this
        // NOTE: fromBlock/toBlock are naive here.
        // We can optimize later by caching a "deployment block" or passing hint ranges.
        const rawLogs = await dstProvider.getLogs({
            address: interopHandler,
            fromBlock: 0n,
            toBlock: 'latest',
            topics: [eventTopic, bundleHash],
        });

        return rawLogs.map((log) => ({
            txHash: log.transactionHash as Hex,
            rawTopics: log.topics as readonly Hex[],
            rawData: log.data as Hex,
        }));
    }

    // Pull logs for each lifecycle event class
    return await wrap(
        OP_INTEROP.svc.status.dstLogs,
        async () => {
            const unbundledLogs = await fetchLogsFor(unbundledTopic);
            if (unbundledLogs.length > 0) {
                const txHash = unbundledLogs.at(-1)!.txHash;
                return { phase: 'UNBUNDLED', dstExecTxHash: txHash };
            }
            const executedLogs = await fetchLogsFor(executedTopic);
            if (executedLogs.length > 0) {
                const txHash = executedLogs.at(-1)!.txHash;
                return { phase: 'EXECUTED', dstExecTxHash: txHash };
            }

            const verifiedLogs = await fetchLogsFor(verifiedTopic);
            if (verifiedLogs.length > 0) {
                return { phase: 'VERIFIED' };
            }

            return { phase: 'SENT' };
        },
        {
            ctx: { bundleHash, dstChainId, interopHandler },
            message: 'Failed to query destination bundle lifecycle logs.',
        },
    );
}

/**
 * Public-facing service interface
 */
export interface InteropFinalizationServices {
    deriveStatus(input: InteropWaitable): Promise<InteropStatus>;

    waitForPhase(
        input: InteropWaitable,
        target: 'verified' | 'executed',
        opts?: { pollMs?: number; timeoutMs?: number },
    ): Promise<void>;

    executeBundle(
        bundleHash: Hex,
        dstChainId: bigint,
    ): Promise<{ hash: Hex; wait: () => Promise<TransactionReceipt> }>;
}

export function createInteropFinalizationServices(
    client: EthersClient,
): InteropFinalizationServices {
    return {
        async deriveStatus(input) {
            // 1. normalize ids
            const baseIds = resolveIdsFromWaitable(input);

            // 2. enrich with bundleHash/dstChainId if missing
            const enrichedIds = await wrap(
                OP_INTEROP.svc.status.derive,
                async () => {
                    if (baseIds.bundleHash && baseIds.dstChainId) {
                        return baseIds;
                    }
                    if (!baseIds.l2SrcTxHash) {
                        // can't enrich without source tx hash
                        return baseIds;
                    }
                    const { bundleHash, dstChainId } = await parseBundleSentFromSource({
                        client,
                        l2SrcTxHash: baseIds.l2SrcTxHash,
                    });
                    return {
                        ...baseIds,
                        bundleHash,
                        dstChainId,
                    };
                },
                {
                    ctx: { input: baseIds },
                    message: 'Failed deriving bundle identifiers (bundleHash/dstChainId).',
                },
            );

            // 3. if we still don't know bundleHash/dstChainId, we can only say SENT/UNKNOWN
            if (!enrichedIds.bundleHash || enrichedIds.dstChainId == null) {
                const phase: InteropPhase = enrichedIds.l2SrcTxHash ? 'SENT' : 'UNKNOWN';
                const status: InteropStatus = {
                    phase,
                    l2SrcTxHash: enrichedIds.l2SrcTxHash,
                    bundleHash: enrichedIds.bundleHash,
                    dstExecTxHash: enrichedIds.dstExecTxHash,
                    dstChainId: enrichedIds.dstChainId,
                };
                return status;
            }

            // 4. ask destination chain where we are
            const dstInfo = await queryDstBundleLifecycle({
                client,
                bundleHash: enrichedIds.bundleHash,
                dstChainId: enrichedIds.dstChainId,
            });

            // 5. combine and return
            const out: InteropStatus = {
                phase: dstInfo.phase,
                l2SrcTxHash: enrichedIds.l2SrcTxHash,
                bundleHash: enrichedIds.bundleHash,
                dstExecTxHash: dstInfo.dstExecTxHash ?? enrichedIds.dstExecTxHash,
                dstChainId: enrichedIds.dstChainId,
            };
            return out;
        },

        async waitForPhase(input, target, opts) {
            const pollMs = opts?.pollMs ?? 3_000;
            const timeoutMs = opts?.timeoutMs ?? 120_000;
            const start = Date.now();

            function phaseSatisfied(phase: InteropPhase): boolean {
                if (target === 'verified') {
                    return phase === 'VERIFIED' || phase === 'EXECUTED' || phase === 'UNBUNDLED';
                }
                // target === 'executed'
                return phase === 'EXECUTED' || phase === 'UNBUNDLED';
            }

            // poll loop
            while (true) {
                // timeout check
                if (Date.now() - start > timeoutMs) {
                    throw toZKsyncError(
                        'TIMEOUT',
                        {
                            resource: 'interop',
                            operation: OP_INTEROP.svc.wait.timeout,
                            message: `Timed out waiting for interop bundle to reach ${target}.`,
                            context: { target, timeoutMs },
                        },
                        new Error('timeout'),
                    );
                }

                const status = await wrap(OP_INTEROP.svc.wait.poll, () => this.deriveStatus(input), {
                    ctx: { target },
                    message: 'Failed while polling interop bundle status.',
                });

                if (phaseSatisfied(status.phase)) {
                    return;
                }

                await new Promise((r) => setTimeout(r, pollMs));
            }
        },

        async executeBundle(bundleHash, dstChainId) {
            // 1. get signer for destination chain
            const signer = await wrap(
                OP_INTEROP.exec.sendStep,
                () => client.signerFor(dstChainId),
                {
                    ctx: { dstChainId, bundleHash },
                    message: 'Failed to resolve destination signer.',
                },
            );

            // 2. get interopHandler address
            const { interopHandler } = await wrap(
                OP_INTEROP.svc.status.ensureAddresses,
                () => client.ensureAddresses(),
                {
                    ctx: { where: 'ensureAddresses' },
                    message: 'Failed to ensure interop handler address.',
                },
            );

            // 3. send executeBundle(bundleHash)
            const handler = new Contract(interopHandler, IInteropHandlerAbi, signer) as Contract & {
                executeBundle: (bundleHash: Hex) => Promise<ContractTransactionResponse>;
            };

            try {
                const txResp: ContractTransactionResponse = await handler.executeBundle(bundleHash);

                const hash = txResp.hash as Hex;

                return {
                    hash,
                    wait: async () => {
                        try {
                            return (await txResp.wait()) as TransactionReceipt;
                        } catch (e) {
                            throw toZKsyncError(
                                'EXECUTION',
                                {
                                    resource: 'interop',
                                    operation: OP_INTEROP.exec.waitStep,
                                    message: 'Failed while waiting for executeBundle transaction on destination.',
                                    context: { bundleHash, dstChainId, txHash: hash },
                                },
                                e,
                            );
                        }
                    },
                };
            } catch (e) {
                throw toZKsyncError(
                    'EXECUTION',
                    {
                        resource: 'interop',
                        operation: OP_INTEROP.exec.sendStep,
                        message: 'Failed to send executeBundle transaction on destination chain.',
                        context: { bundleHash, dstChainId },
                    },
                    e,
                );
            }
        },
    };
}

// -----------------------------
// Thin wrappers that the resource factory calls
// -----------------------------
export async function status(client: EthersClient, h: InteropWaitable): Promise<InteropStatus> {
    const svc = createInteropFinalizationServices(client);
    return svc.deriveStatus(h);
}

export async function wait(
    client: EthersClient,
    h: InteropWaitable,
    opts: { for: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
): Promise<null> {
    const svc = createInteropFinalizationServices(client);

    await svc.waitForPhase(h, opts.for, {
        pollMs: opts.pollMs,
        timeoutMs: opts.timeoutMs,
    });

    return null;
}
