// examples/withdrawals-eth.ts
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '@matter-labs/zksync-js/ethers';
import { ETH_ADDRESS } from '@matter-labs/zksync-js/core';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

async function main() {
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new Wallet(PRIVATE_KEY, l1);

  const client = createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  const me = (await signer.getAddress());

  // Withdraw params (ETH)
  const params = {
    token: ETH_ADDRESS,
    amount: parseEther('0.01'), // 0.001 ETH
    to: me,
    // l2GasLimit: 300_000n,
  } as const;

  // Quote (dry-run only)
  const quote = await sdk.withdrawals.quote(params);
  console.log('QUOTE: ', quote);

  const prepare = await sdk.withdrawals.prepare(params);
  console.log('PREPARE: ', prepare);

  const created = await sdk.withdrawals.create(params);
  console.log('CREATE:', created);

  // Quick status check
  console.log('STATUS (initial):', await sdk.withdrawals.status(created.l2TxHash));

  // wait for L2 inclusion
  const l2Receipt = await sdk.withdrawals.wait(created, { for: 'l2' });
  console.log(
    'L2 included: block=',
    l2Receipt?.blockNumber,
    'status=',
    l2Receipt?.status,
    'hash=',
    l2Receipt?.hash,
  );

  // Optional: check status again
  console.log('STATUS (post-L2):', await sdk.withdrawals.status(created.l2TxHash));

  // finalize on L1
  // Use tryFinalize to avoid throwing in an example script
  await sdk.withdrawals.wait(created.l2TxHash, { for: 'ready' });
  console.log('STATUS (ready):', await sdk.withdrawals.status(created.l2TxHash));

  const fin = await sdk.withdrawals.tryFinalize(created.l2TxHash);
  console.log('TRY FINALIZE: ', fin);

  const l1Receipt = await sdk.withdrawals.wait(created.l2TxHash, { for: 'finalized' });
  if (l1Receipt) {
    console.log('L1 finalize receipt:', l1Receipt.hash);
  } else {
    console.log('Finalized (no local L1 receipt available, possibly finalized by another actor).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
