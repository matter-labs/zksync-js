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
   * Build finalizeDeposit params.
   */
  fetchFinalizeDepositParams(
    l2TxHash: Hex,
  ): Promise<{ params: FinalizeDepositParams; nullifier: Address }>;

  /**
   * Read the Nullifier mapping to check finalization status.
   */
  isWithdrawalFinalized(key: WithdrawalKey): Promise<boolean>;

  /**
   * Simulate finalizeDeposit on L1 Nullifier to check readiness.
   */
  simulateFinalizeReadiness(params: FinalizeDepositParams): Promise<FinalizeReadiness>;

  /**
   * Estimate gas & fees for finalizeDeposit on L1 Nullifier.
   */
  estimateFinalization(params: FinalizeDepositParams): Promise<FinalizationEstimate>;

  /**
   * Call finalizeDeposit on L1 Nullifier.
   */
  finalizeDeposit(
    params: FinalizeDepositParams,
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
// 1) Build finalize params + discover the L1 Nullifier to call
const { params } = await svc.fetchFinalizeDepositParams(handle.l2TxHash);
const key: WithdrawalKey = {
  chainIdL2: params.chainId,
  l2BatchNumber: params.l2BatchNumber,
  l2MessageIndex: params.l2MessageIndex,
};
// 2) (Optional) check finalization
const already = await svc.isWithdrawalFinalized(key);
if (already) {
  console.log('Already finalized on L1');
} else {
  // 3) Dry-run on L1 to confirm readiness (no gas spent)
  const readiness = await svc.simulateFinalizeReadiness(params);

  if (readiness.kind === 'READY') {
    // 4) Submit finalize tx
    const { hash, wait } = await svc.finalizeDeposit(params);
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
