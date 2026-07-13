import { describe, it } from 'bun:test';

// ANCHOR: imports
import { JsonRpcProvider, Wallet } from 'ethers';
import {
  createEthersClient,
  createEthersSdk,
  type AtomicInteropCommitment,
  type EthersSdk,
  type InteropParams,
} from '../../../../src/adapters/ethers';
import type { Address } from '../../../../src/core';
// ANCHOR_END: imports

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';
const TOKEN_SRC_ADDRESS = process.env.TOKEN_SRC_ADDRESS as Address;

describe.skip('ethers atomic interop guide requires an upgraded multi-chain environment', () => {
  it('creates an ERC-20 atomic leg', async () => main());
});

// ANCHOR: main
async function main() {
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2Source = new JsonRpcProvider(SRC_L2_RPC);
  const l2Destination = new JsonRpcProvider(DST_L2_RPC);
  const signer = new Wallet(PRIVATE_KEY);
  const client = createEthersClient({ l1, l2: l2Source, signer });
  const sdk = createEthersSdk(client, {
    interop: { enableExperimentalAtomicSend: true },
  });

  const deadline = await sdk.interop.getSettlementDeadline({ afterSeconds: 3_600 });
  const params: InteropParams = {
    deadline,
    actions: [
      {
        type: 'sendErc20',
        token: TOKEN_SRC_ADDRESS,
        to: signer.address as Address,
        amount: 1_000_000n,
      },
    ],
  };

  // ANCHOR: quote
  const quote = await sdk.interop.quote(l2Destination, params);
  // quote.approvalsNeeded contains the exact source-chain requirements.
  // ANCHOR_END: quote

  // ANCHOR: approve
  await sdk.interop.approve(l2Destination, params);
  // ANCHOR_END: approve

  // ANCHOR: single-leg-intent
  const draft = await sdk.interop.previewLeg(l2Destination, params);
  const flow = sdk.interop.defineFlow({
    legs: [draft.commitment],
    deadline,
    settlementLayerChainId: draft.settlementLayerChainId,
  });
  const intent = sdk.interop.bindFlow(draft, flow);
  // ANCHOR_END: single-leg-intent

  // ANCHOR: prepare
  const plan = await sdk.interop.prepare(l2Destination, intent);
  // ANCHOR_END: prepare

  // ANCHOR: create
  const handle = await sdk.interop.create(l2Destination, intent);
  // ANCHOR_END: create

  // ANCHOR: status
  const status = await sdk.interop.status(l2Destination, handle);
  // status reports source LegState and destination bundleStatus only.
  // ANCHOR_END: status

  void quote;
  void plan;
  void status;
}
// ANCHOR_END: main

// ANCHOR: multi-leg
async function bindMultiLegFlow(
  sdk: EthersSdk,
  destination: JsonRpcProvider,
  params: InteropParams,
  otherCommitment: AtomicInteropCommitment,
) {
  await sdk.interop.approve(destination, params);
  const localDraft = await sdk.interop.previewLeg(destination, params);

  // Exchange only localDraft.commitment with the other participants.
  const flow = sdk.interop.defineFlow({
    legs: [localDraft.commitment, otherCommitment],
    deadline: params.deadline,
    settlementLayerChainId: localDraft.settlementLayerChainId,
  });
  return sdk.interop.bindFlow(localDraft, flow);
}
// ANCHOR_END: multi-leg

// ANCHOR: try-create
async function createWithoutThrowing(
  sdk: EthersSdk,
  destination: JsonRpcProvider,
  params: InteropParams,
) {
  const result = await sdk.interop.tryCreate(destination, params);
  if (!result.ok) return { error: result.error };
  return { handle: result.value };
}
// ANCHOR_END: try-create

void bindMultiLegFlow;
void createWithoutThrowing;
