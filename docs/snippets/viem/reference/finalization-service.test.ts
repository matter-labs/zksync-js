import { beforeAll, describe, it } from 'bun:test';

// ANCHOR: imports
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { createViemClient, createViemSdk, createFinalizationServices } from '../../../../src/adapters/viem';
// ANCHOR_END: imports
import { ETH_ADDRESS } from '../../../../src/core/constants';
import { l1Chain, l2Chain } from '../chains';
import type { FinalizationServices, ViemSdk  } from '../../../../src/adapters/viem';
import type { Account } from 'viem';
import type { WithdrawalKey } from '../../../../src/core/types/flows/withdrawals';

describe('viem finalization service', () => {

  let viemSDK: ViemSdk;
  let me: Account;
  let service: FinalizationServices;

beforeAll(() => {
// ANCHOR: init-sdk
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(process.env.L1_RPC!) });
const l2Wallet = createWalletClient({ chain: l2Chain, account, transport: http(process.env.L2_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
const sdk = createViemSdk(client); // optional
const svc = createFinalizationServices(client);
// ANCHOR_END: init-sdk
  viemSDK = sdk;
  me = account;
  service = svc;
})

it('creates a withdrawal', async () => {
const account = me;
const sdk = viemSDK;
const svc = service;
const handle = await sdk.withdrawals.create({
    token: ETH_ADDRESS, // ETH sentinel supported
    amount: parseEther('0.1'),
    to: account.address, // L1 recipient
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
