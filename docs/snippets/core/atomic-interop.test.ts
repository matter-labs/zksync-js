import { describe, expect, it } from 'bun:test';

// ANCHOR: imports
import {
  computeBundleHash,
  readSettlementLayerReference,
  toOnchainImtProof,
  type AtomicLeg,
  type ImtProofResponse,
  type InteropBundle,
} from '../../../src/core';
import {
  createViemAtomicInteropHelpers,
  createViemAttributesResource,
  formatInteropEvmChainAddress,
} from '../../../src/adapters/viem';
// ANCHOR_END: imports

// A two-leg flow that both chains committed on, so the contracts accepted this flow id.
const LEGS: AtomicLeg[] = [
  {
    bundleHash: '0xf1019487f5ce192a3dda56d371898b0666a985edb5ae2aa643c4037daa8e8ef2',
    sourceChainId: 6565n,
  },
  {
    bundleHash: '0xecd46742f94d604c8cc238fb0496bd59d65a8911f47e0a917c4e4ba24a6de6a3',
    sourceChainId: 6566n,
  },
];

describe('atomic interop docs examples', () => {
  it('builds a flow, its commit values and its attribute', () => {
    const legs = LEGS;
    const myLeg = LEGS[0];
    const lowNullifierIndex = 0n;

    // ANCHOR: build-flow
    const atomic = createViemAtomicInteropHelpers();
    const attributes = createViemAttributesResource();

    // Every participant derives the same flow from the same legs, in any order.
    const flow = atomic.buildFlow({
      deadline: 1793832592n, // a settlement-layer timestamp
      settlementLayerChainId: 31337n,
      legs, // [{ bundleHash, sourceChainId }, ...]
    });

    // The value committing my leg inserts into my chain's commitment tree.
    const commitValue = atomic.computeCommitValue(flow.flowId, myLeg.bundleHash);

    // The bundle attribute that commits my leg when I send it with `sendBundle`.
    // `lowNullifierIndex` comes from `client.zks.getImtLowNullifierIndex(commitValue, block)`.
    const atomicAttribute = attributes.bundle.atomicBundle(flow.preimage, lowNullifierIndex);
    // ANCHOR_END: build-flow

    expect(flow.flowId).toBe('0x2af37e0e6ff01e70a247d30d4a49b00e4f66fe7e2556859c9db1913decd241a6');
    expect(commitValue).toBe('0xbf46f3736f96212d94f9bf2803786051d4f91743877621a1b8401495dd3cf915');
    expect(atomicAttribute.startsWith('0xe6b4aade')).toBe(true);
  });

  it('checks bundle bytes and orders proofs', () => {
    const atomic = createViemAtomicInteropHelpers();
    const flow = atomic.buildFlow({ deadline: 1n, settlementLayerChainId: 1n, legs: LEGS });
    const proofFor = (leg: AtomicLeg): ImtProofResponse => ({
      batchNumber: 1n,
      settlementBlockNumber: 2n,
      provesAgainstBeginRoot: false,
      chainImtRoot: `0x${'11'.repeat(32)}`,
      settlementProof: [],
      leaf: {
        value: BigInt(atomic.computeCommitValue(flow.flowId, leg.bundleHash)),
        nextIndex: 0n,
        nextValue: 0n,
      },
      imtLeafIndex: 1n,
      imtProof: [],
    });
    const [proofA, proofB] = LEGS.map(proofFor);
    const [chainA, chainB] = [LEGS[0].sourceChainId, LEGS[1].sourceChainId];
    const bundle: InteropBundle = {
      version: '0x01',
      sourceChainId: 7101n,
      destinationChainId: 7102n,
      destinationBaseTokenAssetId: `0x${'0e'.repeat(32)}`,
      interopBundleSalt: `0x${'05'.repeat(32)}`,
      calls: [],
      bundleAttributes: {
        executionAddress: '0x',
        unbundlerAddress: formatInteropEvmChainAddress(7101n, `0x${'11'.repeat(20)}`),
        useFixedFee: false,
        salt: `0x${'22'.repeat(32)}`,
      },
    };
    const bundleData = atomic.encodeInteropBundle(bundle);
    const agreedSender = `0x${'11'.repeat(20)}` as const;
    // The flow the participants agreed on, with this bundle as one of its legs.
    const agreedFlow = atomic.buildFlow({
      deadline: 1n,
      settlementLayerChainId: 1n,
      legs: [{ bundleHash: computeBundleHash(bundleData), sourceChainId: 7101n }, LEGS[1]],
    });

    // ANCHOR: check-bundle
    // Bundle bytes received from another participant: bind them to a leg of the agreed flow,
    // then check that they do what was agreed.
    const bundleHash = computeBundleHash(bundleData);
    const leg = atomic.legIndex(agreedFlow, bundleHash); // throws if the bytes are not a leg
    const received = atomic.decodeInteropBundle(bundleData);
    if (received.sourceChainId !== agreedFlow.preimage.legSourceChainIds[leg]) {
      throw new Error('the bundle comes from another chain than its leg');
    }
    // e.g. require permissionless execution, with the agreed sender as unbundler
    const permissionless = received.bundleAttributes.executionAddress === '0x';
    const unbundler = formatInteropEvmChainAddress(received.sourceChainId, agreedSender);
    if (!permissionless || received.bundleAttributes.unbundlerAddress !== unbundler) {
      throw new Error('the bundle does not have the agreed execution terms');
    }
    // ANCHOR_END: check-bundle

    // ANCHOR: finality
    // Inclusion proofs from each leg's source chain node, in any order:
    //   const proofA = await clientA.zks.getImtInclusionProof(commitValueA, commitBlockA);
    const finality = atomic.buildFinalityProof(flow, [
      toOnchainImtProof(proofB, chainB),
      toOnchainImtProof(proofA, chainA),
    ]);
    // finality.proofs is in flow.preimage.legBundleHashes order; pass it with the bundle bytes to
    // IL2InteropHandler.executeAtomicBundle(bundleData, finality).
    // ANCHOR_END: finality

    expect(agreedFlow.preimage.legBundleHashes[leg]).toBe(bundleHash);
    expect(() => atomic.legIndex(flow, bundleHash)).toThrow(/not in the flow/);
    expect(finality.proofs.map((p) => p.sourceChainId)).toEqual(flow.preimage.legSourceChainIds);
  });

  it('reads where a proof ends on the settlement layer', () => {
    const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}` as const;
    // metadata (version 1, 0 words to the batch root, 0 words to the settlement root), the batch
    // timestamp, the batch-leaf mask, the packed batch info, the settlement layer chain id
    const proof = {
      settlementProof: [
        `0x01${'00'.repeat(31)}`,
        word(1_795_000_000n),
        word(0n),
        word(4321n << 128n),
        word(31337n),
      ] as `0x${string}`[],
    };
    const deadline = 1_796_000_000n;

    // ANCHOR: settlement-reference
    const { l1BatchTimestamp, settlementLayerBatchNumber, settlementLayerChainId } =
      readSettlementLayerReference(proof.settlementProof);
    // The leg settled in time if its batch was included by the deadline. The verifying chain
    // needs `interopRoots(settlementLayerChainId, settlementLayerBatchNumber)` imported first.
    const inTime = l1BatchTimestamp <= deadline;
    // ANCHOR_END: settlement-reference

    expect(inTime).toBe(true);
    expect(settlementLayerBatchNumber).toBe(4321n);
    expect(settlementLayerChainId).toBe(31337n);
  });
});
