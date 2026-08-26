/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'bun:test';
import { AbiCoder } from 'ethers';

import { createFinalizationServices as createEthersFinalization } from '../../ethers/resources/withdrawals/services/finalization.ts';
import { createFinalizationServices as createViemFinalization } from '../../viem/resources/withdrawals/services/finalization.ts';
import {
  L1_MESSENGER_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  TOPIC_L1_MESSAGE_SENT_LEG,
} from '../../../core/constants.ts';
import { ADAPTER_TEST_ADDRESSES } from '../adapter-harness.ts';

const CHAIN_ID = 88288n;
const L2_TX_HASH = ('0x' + '1a'.repeat(32)) as `0x${string}`;
const MESSAGE = '0xdeadbeef' as const;

const INITIATING_CONTRACT = '0x8FEa35F40E787cf7C182546B6B9056846704c033' as const;

const pad = (addr: string) => `0x${'0'.repeat(24)}${addr.slice(2)}`;

// Withdrawal triggered onchain: `to` is the dapp's contract, the message is the router's.
const receipt = (to: string) => ({
  to,
  transactionIndex: 3,
  logs: [
    {
      address: L1_MESSENGER_ADDRESS,
      topics: [TOPIC_L1_MESSAGE_SENT_LEG, pad(L2_ASSET_ROUTER_ADDRESS), '0x' + 'cc'.repeat(32)],
      data: AbiCoder.defaultAbiCoder().encode(['bytes'], [MESSAGE]),
      transactionHash: L2_TX_HASH,
    },
  ],
  l2ToL1Logs: [{ sender: L1_MESSENGER_ADDRESS }],
});

const proof = { batchNumber: 108194n, id: 0n, proof: ['0x' + 'ab'.repeat(32)] };

const zks = (to: string) => ({
  getReceiptWithL2ToL1: () => Promise.resolve(receipt(to)),
  getL2ToL1LogProof: () => Promise.resolve(proof),
});

const ethersClient = (to: string) =>
  ({
    l1: {},
    signer: {},
    l2: { getNetwork: () => Promise.resolve({ chainId: CHAIN_ID }) },
    zks: zks(to),
    ensureAddresses: () => Promise.resolve({ l1Nullifier: ADAPTER_TEST_ADDRESSES.l1Nullifier }),
  }) as any;

const viemClient = (to: string) =>
  ({
    l1: {},
    l2: { getChainId: () => Promise.resolve(Number(CHAIN_ID)) },
    zks: zks(to),
    ensureAddresses: () => Promise.resolve({ l1Nullifier: ADAPTER_TEST_ADDRESSES.l1Nullifier }),
  }) as any;

const ADAPTERS = {
  ethers: (to: string) => createEthersFinalization(ethersClient(to)),
  viem: (to: string) => createViemFinalization(viemClient(to)),
} as const;

for (const kind of ['ethers', 'viem'] as const) {
  describe(`adapters/${kind}/withdrawals/fetchFinalizeDepositParams`, () => {
    it('takes l2Sender from the L1MessageSent log, not the receipt to', async () => {
      const svc = ADAPTERS[kind](INITIATING_CONTRACT);
      const { params } = await svc.fetchFinalizeDepositParams(L2_TX_HASH);

      expect(params.l2Sender.toLowerCase()).toBe(L2_ASSET_ROUTER_ADDRESS.toLowerCase());
      expect(params.l2Sender.toLowerCase()).not.toBe(INITIATING_CONTRACT.toLowerCase());
    });

    it('reports the same l2Sender whether an EOA or a contract initiated the withdrawal', async () => {
      const viaContract =
        await ADAPTERS[kind](INITIATING_CONTRACT).fetchFinalizeDepositParams(L2_TX_HASH);
      const viaEoa =
        await ADAPTERS[kind](L2_ASSET_ROUTER_ADDRESS).fetchFinalizeDepositParams(L2_TX_HASH);

      expect(viaContract.params.l2Sender.toLowerCase()).toBe(viaEoa.params.l2Sender.toLowerCase());
    });

    it('carries through the remaining finalize params', async () => {
      const { params } =
        await ADAPTERS[kind](INITIATING_CONTRACT).fetchFinalizeDepositParams(L2_TX_HASH);

      expect(params.chainId).toBe(CHAIN_ID);
      expect(params.l2BatchNumber).toBe(proof.batchNumber);
      expect(params.l2MessageIndex).toBe(proof.id);
      expect(params.message).toBe(MESSAGE);
      expect(params.merkleProof).toEqual(proof.proof);
      // zksync-os puts the tx index within the *block* in the leaf the L1 struct calls InBatch.
      expect(params.l2TxNumberInBatch).toBe(3);
    });
  });
}
