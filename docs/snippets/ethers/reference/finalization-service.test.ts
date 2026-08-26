import { beforeAll, describe, it } from 'bun:test';

// ANCHOR: imports
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk, createFinalizationServices } from '../../../../src/adapters/ethers';
// ANCHOR_END: imports
import { ETH_ADDRESS } from '../../../../src/core/constants';
import type { EthersSdk, FinalizationServices as FServices } from '../../../../src/adapters/ethers';
import type { Exact } from "../../core/types";
import { WithdrawalKey } from '../../../../src/core/types/flows/withdrawals';
import type { FinalizeDepositParams as FParams, FinalizeReadiness as FReady } from '../../../../src/core/types/flows/withdrawals';
import type { Address, Hex } from 'viem';
import type { TransactionReceipt } from 'ethers';

// ANCHOR: finalization-types
interface FinalizeDepositParams {
  chainId: bigint;
  l2BatchNumber: bigint;
  l2MessageIndex: bigint;
  l2Sender: Address;
  l2TxNumberInBatch: number;
  message: Hex;
  merkleProof: Hex[];
}

// Protocol v32+ finalization inputs: the withdrawal's interop bundle and its inclusion proof.
interface WithdrawalBundleFinalization {
  bundle: Hex;
  bundleHash: Hex;
  proof: {
    chainId: bigint;
    l1BatchNumber: bigint;
    l2MessageIndex: bigint;
    message: { txNumberInBatch: number; sender: Address; data: Hex };
    proof: Hex[];
  };
}

// Outcome of a withdrawal bundle on the destination.
//  - `finalized` — the call ran; funds released on L1
//  - `failed`    — terminally unwound with the call cancelled; funds NOT released
//  - `pending`   — not resolved yet
type WithdrawalOutcome = 'finalized' | 'failed' | 'pending';

// Which contract finalizes the withdrawal, and with which arguments.
//  - `legacy-withdrawal` → L1Nullifier.finalizeDeposit        (protocol v31 and below)
//  - `interop-bundle`     → L1InteropHandler.executeBundle     (protocol v32 and above)
type WithdrawalFinalization =
  | { protocol: 'legacy-withdrawal'; params: FinalizeDepositParams }
  | { protocol: 'interop-bundle'; params: WithdrawalBundleFinalization };

interface ResolvedWithdrawalFinalization {
  target: Address;
  finalization: WithdrawalFinalization;
  key: WithdrawalKey;
}

// Finalization readiness states
// Used for `status()`
type FinalizeReadiness =
  | { kind: 'READY' }
  | { kind: 'FINALIZED' }
  | {
      kind: 'NOT_READY';
      // temporary, retry later
      reason: 'paused' | 'batch-not-executed' | 'root-missing' | 'unknown';
      detail?: string;
    }
  | {
      kind: 'UNFINALIZABLE';
      // permanent, won’t become ready
      reason: 'message-invalid' | 'invalid-chain' | 'settlement-layer' | 'unsupported';
      detail?: string;
    };

interface FinalizationEstimate {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

interface FinalizationServices {
  /**
   * Derive the finalization arguments for a withdrawal, tagged with the protocol they belong to.
   */
  fetchFinalization(l2TxHash: Hex): Promise<ResolvedWithdrawalFinalization>;

  /**
   * Build `finalizeDeposit` params.
   *
   * @deprecated Only meaningful on protocol v31 chains. Throws on v32+, where withdrawals are
   * finalized through the interop handler — use {@link fetchFinalization} instead.
   */
  fetchFinalizeDepositParams(
    l2TxHash: Hex,
  ): Promise<{ params: FinalizeDepositParams; nullifier: Address }>;

  /** Check whether the withdrawal has already been finalized on L1. */
  isWithdrawalFinalized(finalization: WithdrawalFinalization): Promise<boolean>;

  /**
   * Classify the withdrawal's on-chain outcome. Distinguishes a terminally-failed bundle (unwound
   * with its call cancelled) from one that is merely not finalized yet.
   */
  withdrawalOutcome(finalization: WithdrawalFinalization): Promise<WithdrawalOutcome>;

  /** Simulate finalization on L1 to check readiness. */
  simulateFinalizeReadiness(finalization: WithdrawalFinalization): Promise<FinalizeReadiness>;

  /** Estimate gas & fees for finalization on L1. */
  estimateFinalization(finalization: WithdrawalFinalization): Promise<FinalizationEstimate>;

  /** Send the finalization transaction on L1. */
  finalize(
    finalization: WithdrawalFinalization,
  ): Promise<{ hash: string; wait: () => Promise<TransactionReceipt> }>;
}
// ANCHOR_END: finalization-types

describe('ethers finalization service', () => {

  let ethersSDK: EthersSdk;
  let me: Wallet;
  let service: FinalizationServices;

beforeAll(() => {
// ANCHOR: init-sdk
const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2 = new JsonRpcProvider(process.env.L2_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client); // optional
const svc = createFinalizationServices(client);
// ANCHOR_END: init-sdk
  ethersSDK = sdk;
  me = signer
  service = svc;
})

// this test will always succeed
// but any errors will be highlighted
it('checks to see if the finalize withdraw types are updated', async () => {
    const _paramsType: Exact<FinalizeDepositParams, FParams> = true;
    const _finalizeReadinessType: Exact<FinalizeReadiness, FReady> = true;
    const _finalizeServicesType: Exact<FinalizationServices, FServices> = true;
});

it('creates a withdrawal', async () => {
const signer = me;
const sdk = ethersSDK;
const svc = service;
const handle = await sdk.withdrawals.create({
    token: ETH_ADDRESS, // ETH sentinel supported
    amount: parseEther('0.1'),
    to: await signer.getAddress() as `0x${string}`, // L1 recipient
  });
await sdk.withdrawals.wait(handle, { for: 'l2' });
await sdk.withdrawals.wait(handle, { for: 'ready', pollMs: 6000 });

// ANCHOR: finalize-with-svc
// 1) Derive the finalization args + the L1 contract to call. Works on both protocols: pre-v32
//    chains resolve to `L1Nullifier.finalizeDeposit`, v32+ chains to
//    `L1InteropHandler.executeBundle`.
const { finalization, key } = await svc.fetchFinalization(handle.l2TxHash);

// 2) (Optional) check finalization
const already = await svc.isWithdrawalFinalized(finalization);
if (already) {
  console.log('Already finalized on L1', key);
} else {
  // 3) Dry-run on L1 to confirm readiness (no gas spent)
  const readiness = await svc.simulateFinalizeReadiness(finalization);

  if (readiness.kind === 'READY') {
    // 4) Submit finalize tx
    const { hash, wait } = await svc.finalize(finalization);
    console.log('L1 finalize tx:', hash);
    const rcpt = await wait();
    console.log('Finalized in block:', rcpt.blockNumber);
  } else {
    console.warn('Not ready to finalize:', readiness);
  }
}
// ANCHOR_END: finalize-with-svc
});


});
