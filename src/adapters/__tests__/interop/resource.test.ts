import { describe, expect, it } from 'bun:test';
import { AbiCoder, Interface, ZeroHash, keccak256 } from 'ethers';
import type { Address, Hex } from '../../../core/types/primitives';
import type { InteropParams } from '../../../core/types/flows/interop';
import {
  IAtomicFlowManagerABI,
  IBridgehubABI,
  IERC20ABI,
  IInteropCenterABI,
  IInteropHandlerABI,
  IL2InteropCommitmentTreeABI,
  L2NativeTokenVaultABI,
} from '../../../core/abi';
import {
  L2_ATOMIC_FLOW_MANAGER_ADDRESS,
  L2_INTEROP_CENTER_ADDRESS,
  L2_INTEROP_COMMITMENT_TREE_ADDRESS,
  L2_INTEROP_HANDLER_ADDRESS,
} from '../../../core/constants';
import { createInteropResource as createEthersInteropResource } from '../../ethers/resources/interop';
import { createInteropResource as createViemInteropResource } from '../../viem/resources/interop';
import {
  ADAPTER_TEST_ADDRESSES,
  createAdapterHarness,
  setErc20Allowance,
  setInteropProtocolFee,
  setL2TokenRegistration,
} from '../adapter-harness';
import { parseSendBundleTx } from '../decode-helpers';

const SOURCE_CHAIN_ID = 324n;
const DESTINATION_CHAIN_ID = 325n;
const SETTLEMENT_CHAIN_ID = 324n;
const TARGET = '0x2222222222222222222222222222222222222222' as Address;
const TOKEN = '0x3333333333333333333333333333333333333333' as Address;
const SALT = `0x${'44'.repeat(32)}` as Hex;
const TX_HASH = `0x${'aa'.repeat(32)}` as Hex;
const ASSET_ID = `0x${'12'.repeat(32)}` as Hex;
const DEADLINE = 1_900_000_000n;
const centerInterface = new Interface(IInteropCenterABI);
const bridgehubInterface = new Interface(IBridgehubABI);
const treeInterface = new Interface(IL2InteropCommitmentTreeABI);
const managerInterface = new Interface(IAtomicFlowManagerABI);
const handlerInterface = new Interface(IInteropHandlerABI);

const CALL_PARAMS: InteropParams = {
  actions: [
    {
      type: 'call',
      to: TARGET,
      data: '0x12345678',
      recovery: { protocol: 'IAtomicRecoverable' },
    },
  ],
  deadline: DEADLINE,
};

function normalizeViemAccount(harness: any) {
  if (harness.kind !== 'viem' || typeof harness.client.account !== 'string') return;
  const account = { address: harness.client.account, type: 'json-rpc' } as const;
  harness.client.account = account;
  harness.l1Wallet.account = account;
  harness.l2Wallet.account = account;
}

function destinationProvider(kind: 'ethers' | 'viem', harness: any) {
  return kind === 'ethers'
    ? { ...harness.l2, getNetwork: async () => ({ chainId: DESTINATION_CHAIN_ID }) }
    : { ...harness.l2, getChainId: async () => Number(DESTINATION_CHAIN_ID) };
}

function seedAtomicReads(harness: any, bundleHash: Hex) {
  harness.registry.set(
    ADAPTER_TEST_ADDRESSES.bridgehub,
    bridgehubInterface,
    'baseToken',
    ADAPTER_TEST_ADDRESSES.baseTokenFor324,
    [DESTINATION_CHAIN_ID],
  );
  setInteropProtocolFee(harness, L2_INTEROP_CENTER_ADDRESS, 0n);
  harness.registry.set(
    L2_INTEROP_CENTER_ADDRESS,
    centerInterface,
    'isInteropBundleSaltUsed',
    false,
    [ADAPTER_TEST_ADDRESSES.signer, SALT],
  );
  harness.registry.set(L2_INTEROP_CENTER_ADDRESS, centerInterface, 'previewBundleHash', bundleHash);
  harness.registry.set(L2_INTEROP_COMMITMENT_TREE_ADDRESS, treeInterface, 'leafCount', 1n);
  harness.registry.set(
    L2_INTEROP_COMMITMENT_TREE_ADDRESS,
    treeInterface,
    'leafAt',
    { value: 0n, nextIndex: 0n, nextValue: 0n },
    [0n],
  );
}

function createResource(kind: 'ethers' | 'viem', harness: any, experimental = true) {
  normalizeViemAccount(harness);
  const config = { enableExperimentalAtomicSend: experimental };
  const internal = { generateSalt: () => SALT };
  return kind === 'ethers'
    ? createEthersInteropResource(harness.client, config, undefined, undefined, undefined, internal)
    : createViemInteropResource(harness.client, config, undefined, undefined, undefined, internal);
}

function emittedAtomicBundle(l2l1MsgHash: Hex = ZeroHash as Hex) {
  const event = centerInterface.getEvent('InteropBundleSent')!;
  const interopBundleSalt = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'bytes32'],
      [ADAPTER_TEST_ADDRESSES.signer, SALT],
    ),
  ) as Hex;
  const bundle = [
    '0x01',
    SOURCE_CHAIN_ID,
    DESTINATION_CHAIN_ID,
    ZeroHash,
    interopBundleSalt,
    [
      [
        '0x01',
        false,
        TARGET,
        ADAPTER_TEST_ADDRESSES.signer,
        0n,
        CALL_PARAMS.actions[0].type === 'call' ? CALL_PARAMS.actions[0].data : '0x',
      ],
    ],
    ['0x', '0x', false, SALT],
  ];
  const encodedBundle = AbiCoder.defaultAbiCoder().encode([event.inputs[2]], [bundle]) as Hex;
  const bundleHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(['uint256', 'bytes'], [SOURCE_CHAIN_ID, encodedBundle]),
  ) as Hex;
  const encodedEvent = centerInterface.encodeEventLog(event, [l2l1MsgHash, bundleHash, bundle]);
  return {
    bundleHash,
    encodedBundle,
    log: {
      address: L2_INTEROP_CENTER_ADDRESS,
      data: encodedEvent.data,
      topics: encodedEvent.topics,
    },
  };
}

describe('atomic interop intent resource', () => {
  for (const kind of ['ethers', 'viem'] as const) {
    it(`${kind} gates prepare and create without exposing placeholders`, async () => {
      const harness = createAdapterHarness(kind);
      const resource = createResource(kind, harness, false);
      const destination = destinationProvider(kind, harness);
      await expect(resource.prepare(destination as never, CALL_PARAMS)).rejects.toThrow(
        /enableExperimentalAtomicSend/,
      );
      await expect(resource.create(destination as never, CALL_PARAMS)).rejects.toThrow(
        /enableExperimentalAtomicSend/,
      );
      expect((resource as Record<string, unknown>).wait).toBeUndefined();
      expect((resource as Record<string, unknown>).finalize).toBeUndefined();
      expect((resource as Record<string, unknown>).refund).toBeUndefined();
    });

    it(`${kind} previews and prepares a self-contained one-leg intent`, async () => {
      const harness = createAdapterHarness(kind);
      const expectedHash = `0x${'66'.repeat(32)}` as Hex;
      seedAtomicReads(harness, expectedHash);
      const resource = createResource(kind, harness);
      const destination = destinationProvider(kind, harness);

      const draft = await resource.previewLeg(destination as never, CALL_PARAMS);
      expect(draft.bundleHash).toBe(expectedHash);
      expect(draft.salt).toBe(SALT);
      expect(draft.sender).toBe(ADAPTER_TEST_ADDRESSES.signer);
      const flow = resource.defineFlow({ legs: [draft], deadline: DEADLINE });
      const intent = resource.bindFlow(draft, flow);
      const plan = await resource.prepare(destination as never, intent);

      expect(plan.intent).toEqual(intent);
      expect(plan.bundleHash).toBe(expectedHash);
      expect(plan.lowNullifierIndex).toBe(0n);
      const send = plan.steps.find((step) => step.key === 'sendBundle');
      expect(send).toBeDefined();
      const decoded = parseSendBundleTx(send!.tx);
      expect(decoded.value).toBe(0n);
      expect(decoded.bundleAttributes).toHaveLength(3);

      const tampered = {
        ...intent,
        draft: {
          ...intent.draft,
          payload: { ...intent.draft.payload, value: 1n },
        },
      } as typeof intent;
      await expect(resource.quote(destination as never, tampered)).rejects.toThrow(/payload/);
      await expect(
        resource.quote(destination as never, { ...CALL_PARAMS, deadline: 1_800_000_000n }),
      ).rejects.toThrow(/deadline must be in the future/);
    });

    it(`${kind} reports observable source and destination state without proof readiness`, async () => {
      const harness = createAdapterHarness(kind);
      const expectedHash = `0x${'66'.repeat(32)}` as Hex;
      seedAtomicReads(harness, expectedHash);
      const resource = createResource(kind, harness);
      const destination = destinationProvider(kind, harness);
      const draft = await resource.previewLeg(destination as never, CALL_PARAMS);
      const intent = resource.bindFlow(
        draft,
        resource.defineFlow({ legs: [draft], deadline: DEADLINE }),
      );
      harness.registry.set(L2_ATOMIC_FLOW_MANAGER_ADDRESS, managerInterface, 'legState', 3, [
        intent.flow.flowId,
        expectedHash,
      ]);
      harness.registry.set(L2_INTEROP_HANDLER_ADDRESS, handlerInterface, 'bundleStatus', 2, [
        expectedHash,
      ]);

      const status = await resource.status(destination as never, intent);
      expect(status.phase).toBe('INCONSISTENT');
      expect(status.source.state).toBe('REVERTED');
      expect(status.destination.state).toBe('FULLY_EXECUTED');
      expect((status as Record<string, unknown>).proofReady).toBeUndefined();
    });

    it(`${kind} creates an atomic source leg and validates the emitted bundle`, async () => {
      const harness = createAdapterHarness(kind);
      const emitted = emittedAtomicBundle();
      seedAtomicReads(harness, emitted.bundleHash);
      harness.registry.set(
        L2_INTEROP_CENTER_ADDRESS,
        centerInterface,
        'sendBundle',
        emitted.bundleHash,
      );
      const resource = createResource(kind, harness);
      const destination = destinationProvider(kind, harness);

      if (kind === 'ethers') {
        harness.signer.sendTransaction = async () => ({
          hash: TX_HASH,
          wait: async () => ({ status: 1, logs: [emitted.log] }),
        });
      } else {
        harness.l2Wallet.sendTransaction = async () => TX_HASH;
        harness.l2.waitForTransactionReceipt = async () => ({
          status: 'success',
          logs: [emitted.log],
        });
      }

      const handle = await resource.create(destination as never, CALL_PARAMS);
      expect(handle.l2SrcTxHash).toBe(TX_HASH);
      expect(handle.bundleHash).toBe(emitted.bundleHash);
      expect(handle.encodedBundle).toBe(emitted.encodedBundle);
      expect(handle.plan.intent).toEqual(handle.intent);
    });

    it(`${kind} rejects an atomic receipt that publishes a public message hash`, async () => {
      const harness = createAdapterHarness(kind);
      const emitted = emittedAtomicBundle(`0x${'77'.repeat(32)}` as Hex);
      seedAtomicReads(harness, emitted.bundleHash);
      harness.registry.set(
        L2_INTEROP_CENTER_ADDRESS,
        centerInterface,
        'sendBundle',
        emitted.bundleHash,
      );
      const resource = createResource(kind, harness);
      const destination = destinationProvider(kind, harness);

      if (kind === 'ethers') {
        harness.signer.sendTransaction = async () => ({
          hash: TX_HASH,
          wait: async () => ({ status: 1, logs: [emitted.log] }),
        });
      } else {
        harness.l2Wallet.sendTransaction = async () => TX_HASH;
        harness.l2.waitForTransactionReceipt = async () => ({
          status: 'success',
          logs: [emitted.log],
        });
      }
      await expect(resource.create(destination as never, CALL_PARAMS)).rejects.toThrow(
        /public L2-to-L1 message hash/,
      );
    });

    it(`${kind} approves exact ERC-20 allowances`, async () => {
      const harness = createAdapterHarness(kind);
      seedAtomicReads(harness, `0x${'66'.repeat(32)}` as Hex);
      const addresses = await harness.client.ensureAddresses();
      setL2TokenRegistration(harness, addresses.l2NativeTokenVault, TOKEN, ASSET_ID);
      setErc20Allowance(
        harness,
        TOKEN,
        ADAPTER_TEST_ADDRESSES.signer,
        addresses.l2NativeTokenVault,
        100n,
      );
      const sent: Array<{ data?: Hex }> = [];
      if (kind === 'ethers') {
        harness.signer.sendTransaction = async (tx: { data?: Hex }) => {
          sent.push(tx);
          return { hash: TX_HASH, wait: async () => ({ status: 1, logs: [] }) };
        };
      } else {
        harness.l2Wallet.sendTransaction = async (tx: { data?: Hex }) => {
          sent.push(tx);
          return TX_HASH;
        };
        harness.l2.waitForTransactionReceipt = async () => ({ status: 'success', logs: [] });
      }
      const resource = createResource(kind, harness);
      await resource.approve(destinationProvider(kind, harness) as never, {
        actions: [{ type: 'sendErc20', token: TOKEN, to: TARGET, amount: 25n }],
        deadline: DEADLINE,
      });

      const approveData = sent
        .map((tx) => tx.data)
        .find(
          (data) =>
            data?.slice(0, 10) === new Interface(IERC20ABI).getFunction('approve')!.selector,
        );
      expect(approveData).toBeDefined();
      expect(new Interface(IERC20ABI).decodeFunctionData('approve', approveData!)[1]).toBe(25n);
    });

    it(`${kind} derives settlement deadlines from the configured L1 clock`, async () => {
      const harness = createAdapterHarness(kind);
      const resource = createResource(kind, harness);
      expect(await resource.getSettlementDeadline({ afterSeconds: 60 })).toBe(1_800_000_060n);
    });
  }
});
