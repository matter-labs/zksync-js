import {
    AbiCoder,
    Contract,
    type ContractTransactionResponse,
    Interface,
    type TransactionReceipt,
    ZeroHash,
} from 'ethers';

import type { Hex } from '../../../../../core/types/primitives';
import type { EthersClient } from '../../../client';
import type {
    InteropStatus,
    InteropWaitable,
    InteropPhase,
    InteropFinalizationInfo,
    InteropExpectedRoot,
    InteropMessageProof,
} from '../../../../../core/types/flows/interop';
import type { ProofNormalized, ReceiptWithL2ToL1 } from '../../../../../core/rpc/types';

import { createErrorHandlers, toZKsyncError } from '../../../errors/error-ops';
import { OP_INTEROP } from '../../../../../core/types';
import {
    BUNDLE_IDENTIFIER,
    L1_MESSENGER_ADDRESS,
    L2_INTEROP_CENTER_ADDRESS,
    L2_INTEROP_ROOT_STORAGE_ADDRESS,
    TOPIC_L1_MESSAGE_SENT_LEG,
    TOPIC_L1_MESSAGE_SENT_NEW,
} from '../../../../../core/constants';
import { InteropRootStorageABI } from '../../../../../core/abi';
import { messengerLogIndex } from '../../../../../core/resources/withdrawals/logs';
import { isZKsyncError } from '../../../../../core/types/errors';

// ABIs we need to decode events / send executeBundle()
import InteropCenterAbi from '../../../../../core/internal/abis/InteropCenter';
import IInteropHandlerAbi from '../../../../../core/internal/abis/IInteropHandler';

// error handling
const { wrap } = createErrorHandlers('interop');

const ABI = AbiCoder.defaultAbiCoder();

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

function isFinalizationInfo(
    input: InteropWaitable | Hex | InteropFinalizationInfo,
): input is InteropFinalizationInfo {
    return (
        typeof input === 'object' &&
        input !== null &&
        'encodedData' in input &&
        'proof' in input &&
        'expectedRoot' in input
    );
}

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 300_000;

const L1_MESSENGER_ADDRESS_LOWER = L1_MESSENGER_ADDRESS.toLowerCase();
const L1_MESSAGE_SENT_TOPICS = new Set([
    TOPIC_L1_MESSAGE_SENT_NEW.toLowerCase(),
    TOPIC_L1_MESSAGE_SENT_LEG.toLowerCase(),
]);

function isL1MessageSentLog(log: { address: string; topics: readonly Hex[] }): boolean {
    return log.address.toLowerCase() === L1_MESSENGER_ADDRESS_LOWER &&
        L1_MESSAGE_SENT_TOPICS.has(log.topics[0].toLowerCase());
}

function decodeL1MessageData(log: { data: Hex; topics: readonly Hex[] }): Hex {
    return ABI.decode(['bytes'], log.data)[0] as Hex;
}

function resolveTxIndex(raw: ReceiptWithL2ToL1): number {
    const record = raw as Record<string, unknown>;
    const idxRaw = record.transactionIndex ?? record.transaction_index ?? record.index;
    if (idxRaw == null) return 0;
    if (typeof idxRaw === 'number') return idxRaw;
    if (typeof idxRaw === 'bigint') return Number(idxRaw);
    if (typeof idxRaw === 'string') {
        try {
            return idxRaw.startsWith('0x') ? Number(BigInt(idxRaw)) : Number(idxRaw);
        } catch {
            return 0;
        }
    }
    return 0;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

interface BundleReceiptInfo {
    bundleHash: Hex;
    dstChainId: bigint;
    sourceChainId: bigint;
    l1MessageData: Hex;
    l1MessageIndex: number;
    l2ToL1LogIndex: number;
    txNumberInBatch: number;
    rawReceipt: ReceiptWithL2ToL1;
}

async function parseBundleReceiptInfo(args: {
    client: EthersClient;
    l2SrcTxHash: Hex;
    bundleHash?: Hex;
}): Promise<BundleReceiptInfo> {
    const { client, l2SrcTxHash, bundleHash: wantBundleHash } = args;

    const { interopCenter } = await wrap(
        OP_INTEROP.svc.status.ensureAddresses,
        () => client.ensureAddresses(),
        {
            ctx: { where: 'ensureAddresses' },
            message: 'Failed to ensure interopCenter address.',
        },
    );

    const rawReceipt = await wrap(
        OP_INTEROP.svc.status.sourceReceipt,
        () => client.zks.getReceiptWithL2ToL1(l2SrcTxHash),
        {
            ctx: { where: 'zks.getReceiptWithL2ToL1', l2SrcTxHash },
            message: 'Failed to fetch source L2 receipt (with L2->L1 logs) for interop tx.',
        },
    );

    if (!rawReceipt) {
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

    const centerIface = new Interface(InteropCenterAbi);
    const sentTopic = centerIface.getEvent('InteropBundleSent')!.topicHash as Hex;

    let l1MessageIndex = -1;
    let l1MessageData: Hex | null = null;
    let found:
        | {
            bundleHash: Hex;
            dstChainId: bigint;
            sourceChainId: bigint;
        }
        | undefined;

    for (const log of rawReceipt.logs ?? []) {
        if (isL1MessageSentLog(log)) {
            l1MessageIndex += 1;
            try {
                l1MessageData = decodeL1MessageData(log);
            } catch (e) {
                throw toZKsyncError(
                    'STATE',
                    {
                        resource: 'interop',
                        operation: OP_INTEROP.svc.status.parseSentLog,
                        message: 'Failed to decode L1MessageSent log data for interop bundle.',
                        context: { l2SrcTxHash, l1MessageIndex },
                    },
                    e,
                );
            }
            continue;
        }

        const logAddr = (log.address ?? '').toLowerCase();
        const wantAddr = interopCenter.toLowerCase();

        const t0 = (log.topics?.[0] ?? '').toLowerCase();
        const wantTopic = sentTopic.toLowerCase();

        if (logAddr !== wantAddr || t0 !== wantTopic) {
            continue;
        }

        const decoded = centerIface.decodeEventLog(
            'InteropBundleSent',
            log.data as Hex,
            log.topics as Hex[],
        ) as unknown as {
            interopBundleHash: Hex;
            interopBundle: {
                sourceChainId: bigint;
                destinationChainId: bigint;
            };
        };

        const decodedBundleHash = decoded.interopBundleHash;
        if (wantBundleHash && decodedBundleHash.toLowerCase() !== wantBundleHash.toLowerCase()) {
            continue;
        }

        found = {
            bundleHash: decodedBundleHash,
            dstChainId: decoded.interopBundle.destinationChainId,
            sourceChainId: decoded.interopBundle.sourceChainId,
        };
        break;
    }

    if (!found) {
        throw toZKsyncError(
            'STATE',
            {
                resource: 'interop',
                operation: OP_INTEROP.svc.status.parseSentLog,
                message: 'Failed to locate InteropBundleSent event in source receipt.',
                context: { l2SrcTxHash, interopCenter, bundleHash: wantBundleHash },
            },
            new Error('InteropBundleSent not found'),
        );
    }

    if (!l1MessageData) {
        throw toZKsyncError(
            'STATE',
            {
                resource: 'interop',
                operation: OP_INTEROP.svc.status.parseSentLog,
                message: 'Failed to locate L1MessageSent log data for interop bundle.',
                context: { l2SrcTxHash, interopCenter },
            },
            new Error('L1MessageSent data not found'),
        );
    }

    if (l1MessageIndex < 0) {
        throw toZKsyncError(
            'STATE',
            {
                resource: 'interop',
                operation: OP_INTEROP.svc.status.parseSentLog,
                message: 'Failed to locate L1MessageSent log for interop bundle.',
                context: { l2SrcTxHash },
            },
            new Error('L1MessageSent not found'),
        );
    }

    const l2ToL1LogIndex = await wrap(
        OP_INTEROP.svc.status.parseSentLog,
        () =>
            Promise.resolve(
                messengerLogIndex(rawReceipt, {
                    index: l1MessageIndex,
                    messenger: L1_MESSENGER_ADDRESS,
                }),
            ),
        {
            ctx: { l2SrcTxHash, l1MessageIndex },
            message: 'Failed to derive L2->L1 messenger log index for interop bundle.',
        },
    );

    const txNumberInBatch = resolveTxIndex(rawReceipt);

    return {
        bundleHash: found.bundleHash,
        dstChainId: found.dstChainId,
        sourceChainId: found.sourceChainId,
        l1MessageData,
        l1MessageIndex,
        l2ToL1LogIndex,
        txNumberInBatch,
        rawReceipt,
    };
}

function isProofNotReadyError(err: unknown): boolean {
    if (!isZKsyncError(err)) return false;
    if (err.envelope.operation !== 'zksrpc.getL2ToL1LogProof') return false;

    if (
        err.envelope.type === 'STATE' &&
        err.envelope.message.toLowerCase().includes('proof not yet available')
    ) {
        return true;
    }

    const cause = err.envelope.cause as { message?: unknown; code?: unknown } | undefined;
    const causeMessage = typeof cause?.message === 'string' ? cause.message.toLowerCase() : '';

    return (
        causeMessage.includes('l1 batch') &&
        causeMessage.includes('not') &&
        causeMessage.includes('executed')
    );
}

function isReceiptNotFoundError(err: unknown): boolean {
    if (!isZKsyncError(err)) return false;
    return (
        err.envelope.operation === OP_INTEROP.svc.status.sourceReceipt &&
        err.envelope.type === 'STATE' &&
        err.envelope.message.toLowerCase().includes('receipt not found')
    );
}

async function waitForLogProof(args: {
    client: EthersClient;
    l2SrcTxHash: Hex;
    logIndex: number;
    pollMs: number;
    deadlineMs: number;
}): Promise<ProofNormalized> {
    const { client, l2SrcTxHash, logIndex, pollMs, deadlineMs } = args;

    while (true) {
        if (Date.now() > deadlineMs) {
            throw toZKsyncError(
                'TIMEOUT',
                {
                    resource: 'interop',
                    operation: OP_INTEROP.svc.wait.timeout,
                    message: 'Timed out waiting for L2->L1 log proof to become available.',
                    context: { l2SrcTxHash, logIndex },
                },
                new Error('timeout'),
            );
        }

        try {
            return await client.zks.getL2ToL1LogProof(l2SrcTxHash, logIndex);
        } catch (e) {
            if (isProofNotReadyError(e)) {
                await sleep(pollMs);
                continue;
            }
            throw toZKsyncError(
                'RPC',
                {
                    resource: 'interop',
                    operation: OP_INTEROP.svc.wait.poll,
                    message: 'Failed to fetch L2->L1 log proof.',
                    context: { l2SrcTxHash, logIndex },
                },
                e,
            );
        }
    }
}

async function waitUntilRootAvailable(args: {
    client: EthersClient;
    dstChainId: bigint;
    expectedRoot: InteropExpectedRoot;
    pollMs: number;
    deadlineMs: number;
}): Promise<void> {
    const { client, dstChainId, expectedRoot, pollMs, deadlineMs } = args;

    const dstProvider = await wrap(
        OP_INTEROP.svc.status.requireDstProvider,
        () => client.requireProvider(dstChainId),
        {
            ctx: { where: 'requireProvider', dstChainId },
            message: 'Failed to acquire destination provider.',
        },
    );

    const rootStorage = new Contract(
        L2_INTEROP_ROOT_STORAGE_ADDRESS,
        InteropRootStorageABI,
        dstProvider,
    ) as Contract & {
        interopRoots: (chainId: bigint, batchNumber: bigint) => Promise<Hex>;
    };

    while (true) {
        if (Date.now() > deadlineMs) {
            throw toZKsyncError(
                'TIMEOUT',
                {
                    resource: 'interop',
                    operation: OP_INTEROP.svc.wait.timeout,
                    message: 'Timed out waiting for interop root to become available.',
                    context: { dstChainId, expectedRoot },
                },
                new Error('timeout'),
            );
        }

        let root: Hex | null = null;
        try {
            const candidate = await rootStorage.interopRoots(
                expectedRoot.rootChainId,
                expectedRoot.batchNumber,
            );
            if (candidate && candidate !== ZeroHash) {
                root = candidate as Hex;
            }
        } catch {
            root = null;
        }

        if (root) {
            if (root.toLowerCase() === expectedRoot.expectedRoot.toLowerCase()) {
                return;
            }
            throw toZKsyncError(
                'STATE',
                {
                    resource: 'interop',
                    operation: OP_INTEROP.wait,
                    message: 'Interop root mismatch on destination chain.',
                    context: { expected: expectedRoot.expectedRoot, got: root, dstChainId },
                },
                new Error('root mismatch'),
            );
        }

        await sleep(pollMs);
    }
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

    waitForFinalization(
        input: InteropWaitable | Hex | InteropFinalizationInfo,
        opts?: { pollMs?: number; timeoutMs?: number },
    ): Promise<InteropFinalizationInfo>;

    executeBundle(
        info: InteropFinalizationInfo,
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

        async waitForFinalization(input, opts) {
            const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
            const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
            const deadlineMs = Date.now() + timeoutMs;

            if (isFinalizationInfo(input)) {
                await waitUntilRootAvailable({
                    client,
                    dstChainId: input.dstChainId,
                    expectedRoot: input.expectedRoot,
                    pollMs,
                    deadlineMs,
                });
                return input;
            }

            const ids = resolveIdsFromWaitable(input as InteropWaitable);
            if (!ids.l2SrcTxHash) {
                throw toZKsyncError(
                    'STATE',
                    {
                        resource: 'interop',
                        operation: OP_INTEROP.wait,
                        message: 'Cannot wait for interop finalization: missing l2SrcTxHash.',
                        context: { input },
                    },
                    new Error('missing l2SrcTxHash'),
                );
            }

            let bundleInfo: BundleReceiptInfo | null = null;
            while (!bundleInfo) {
                if (Date.now() > deadlineMs) {
                    throw toZKsyncError(
                        'TIMEOUT',
                        {
                            resource: 'interop',
                            operation: OP_INTEROP.svc.wait.timeout,
                            message: 'Timed out waiting for source receipt to be available.',
                            context: { l2SrcTxHash: ids.l2SrcTxHash },
                        },
                        new Error('timeout'),
                    );
                }

                try {
                    bundleInfo = await parseBundleReceiptInfo({
                        client,
                        l2SrcTxHash: ids.l2SrcTxHash,
                        bundleHash: ids.bundleHash,
                    });
                } catch (e) {
                    if (isReceiptNotFoundError(e)) {
                        await sleep(pollMs);
                        continue;
                    }
                    throw e;
                }
            }
            if (!bundleInfo) {
                throw toZKsyncError(
                    'STATE',
                    {
                        resource: 'interop',
                        operation: OP_INTEROP.wait,
                        message: 'Source receipt data is unavailable for interop bundle.',
                        context: { l2SrcTxHash: ids.l2SrcTxHash },
                    },
                    new Error('missing receipt'),
                );
            }

            const messageData = bundleInfo.l1MessageData;
            if (messageData.length <= 4) {
                throw toZKsyncError(
                    'STATE',
                    {
                        resource: 'interop',
                        operation: OP_INTEROP.wait,
                        message: 'L1MessageSent data is too short to contain bundle payload.',
                        context: { l2SrcTxHash: ids.l2SrcTxHash },
                    },
                    new Error('invalid L1MessageSent data'),
                );
            }

            const prefix = (`0x${messageData.slice(2, 4)}` as Hex).toLowerCase();
            if (prefix !== BUNDLE_IDENTIFIER.toLowerCase()) {
                throw toZKsyncError(
                    'STATE',
                    {
                        resource: 'interop',
                        operation: OP_INTEROP.wait,
                        message: 'Unexpected bundle prefix in L1MessageSent data.',
                        context: { prefix, expected: BUNDLE_IDENTIFIER },
                    },
                    new Error('invalid bundle prefix'),
                );
            }

            const encodedData = `0x${messageData.slice(4)}` as Hex;
            const l2ToL1Message = messageData;

            const proof = await waitForLogProof({
                client,
                l2SrcTxHash: ids.l2SrcTxHash,
                logIndex: bundleInfo.l2ToL1LogIndex,
                pollMs,
                deadlineMs,
            });

            if (!proof.root) {
                throw toZKsyncError(
                    'STATE',
                    {
                        resource: 'interop',
                        operation: OP_INTEROP.wait,
                        message: 'L2->L1 log proof missing expected root.',
                        context: { l2SrcTxHash: ids.l2SrcTxHash },
                    },
                    new Error('missing proof root'),
                );
            }

            const expectedRoot: InteropExpectedRoot = {
                rootChainId: bundleInfo.sourceChainId,
                batchNumber: proof.batchNumber,
                expectedRoot: proof.root,
            };

            const messageProof: InteropMessageProof = {
                chainId: bundleInfo.sourceChainId,
                l1BatchNumber: proof.batchNumber,
                l2MessageIndex: proof.id,
                message: {
                    txNumberInBatch: bundleInfo.txNumberInBatch,
                    sender: L2_INTEROP_CENTER_ADDRESS,
                    data: l2ToL1Message,
                },
                proof: proof.proof,
            };

            await waitUntilRootAvailable({
                client,
                dstChainId: bundleInfo.dstChainId,
                expectedRoot,
                pollMs,
                deadlineMs,
            });

            return {
                l2SrcTxHash: ids.l2SrcTxHash,
                bundleHash: bundleInfo.bundleHash,
                dstChainId: bundleInfo.dstChainId,
                expectedRoot,
                proof: messageProof,
                encodedData,
            };
        },

        async executeBundle(info) {
            const { bundleHash, dstChainId, encodedData, proof } = info;

            const dstStatus = await queryDstBundleLifecycle({
                client,
                bundleHash,
                dstChainId,
            });

            if (dstStatus.phase === 'EXECUTED') {
                throw toZKsyncError(
                    'STATE',
                    {
                        resource: 'interop',
                        operation: OP_INTEROP.finalize,
                        message: 'Interop bundle has already been executed.',
                        context: { bundleHash, dstChainId },
                    },
                    new Error('bundle already executed'),
                );
            }

            if (dstStatus.phase === 'UNBUNDLED') {
                throw toZKsyncError(
                    'STATE',
                    {
                        resource: 'interop',
                        operation: OP_INTEROP.finalize,
                        message: 'Interop bundle has been unbundled and cannot be executed as a whole.',
                        context: { bundleHash, dstChainId },
                    },
                    new Error('bundle unbundled'),
                );
            }

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

            // 3. send executeBundle(bundle, proof)
            const handler = new Contract(interopHandler, IInteropHandlerAbi, signer) as Contract & {
                executeBundle: (
                    bundle: Hex,
                    proof: InteropMessageProof,
                ) => Promise<ContractTransactionResponse>;
            };

            try {
                const txResp: ContractTransactionResponse = await handler.executeBundle(
                    encodedData,
                    proof,
                );

                const hash = txResp.hash as Hex;

                return {
                    hash,
                    wait: async () => {
                        try {
                            const receipt = (await txResp.wait()) as TransactionReceipt | null;
                            if (!receipt || receipt.status !== 1) {
                                throw toZKsyncError(
                                    'EXECUTION',
                                    {
                                        resource: 'interop',
                                        operation: OP_INTEROP.exec.waitStep,
                                        message: 'Interop bundle execution reverted on destination.',
                                        context: { bundleHash, dstChainId, txHash: hash },
                                    },
                                    new Error('execution reverted'),
                                );
                            }
                            return receipt;
                        } catch (e) {
                            if (isZKsyncError(e)) throw e;
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
    opts?: { for?: 'verified' | 'executed'; pollMs?: number; timeoutMs?: number },
): Promise<InteropFinalizationInfo> {
    const svc = createInteropFinalizationServices(client);

    return await svc.waitForFinalization(h, {
        pollMs: opts?.pollMs,
        timeoutMs: opts?.timeoutMs,
    });
}
